const mongoose = require('mongoose');
const EvidenceUnit = require('../models/EvidenceUnit');
const Document = require('../models/Document');
const Conflict = require('../models/Conflict');
const EntityDecision = require('../models/EntityDecision');
const { startAnalysis } = require('../services/analysis');
const { resolveEntities } = require('../services/entityResolution');
const { findDuplicates } = require('../services/duplicates');
const { record } = require('../services/audit');

const visibleDocs = (req) => Document.find({ projectId: req.project._id, status: 'DONE', classification: { $lte: req.clearance } }).select('filename sourceType classification').lean();

// Mentions of units the caller may read; everything derived from them is therefore readable by the caller.
async function visibleMentions(req) {
  const units = await EvidenceUnit.find({ projectId: req.project._id, classification: { $lte: req.clearance }, mentionsAt: { $exists: true } })
    .select('mentions documentId classification').lean();
  return units.flatMap((u) => (u.mentions || []).map((m) => ({ text: m.text, type: m.type, unitId: u._id, docId: u.documentId, classification: u.classification })));
}

async function currentEntities(req) {
  const [mentions, decisions] = await Promise.all([visibleMentions(req), EntityDecision.find({ projectId: req.project._id }).lean()]);
  return resolveEntities(mentions, decisions);
}

// POST /api/projects/:projectId/analysis
async function runAnalysisRoute(req, res) {
  try {
    const started = await startAnalysis({ project: req.project, userId: req.userId, clearance: req.clearance });
    if (!started) return res.status(409).json({ error: 'An analysis is already running for this project' });
    res.status(202).json({ status: 'RUNNING' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/projects/:projectId/analysis
async function analysisStatus(req, res) {
  const { analysis } = req.project.toObject();
  // Counts from a run at a higher clearance could reveal that hidden material exists, so they are not shown.
  const visible = analysis.status === 'DONE' && (analysis.stats.clearance || 0) <= req.clearance;
  res.json({ ...analysis, stats: visible ? analysis.stats : {} });
}

// GET /api/projects/:projectId/entities
async function listEntities(req, res) {
  try {
    const { entities, possible } = await currentEntities(req);
    await record(req.userId, 'ENTITIES_READ', `project:${req.project._id}`, { clearance: req.clearance });
    res.json({ entities, possible });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/projects/:projectId/entities/decisions  { keyA, keyB, decision: 'merge'|'split' }
async function decideEntities(req, res) {
  try {
    const { keyA, keyB, decision } = req.body;
    if (!['merge', 'split'].includes(decision) || typeof keyA !== 'string' || typeof keyB !== 'string' || keyA === keyB) {
      return res.status(400).json({ error: 'keyA, keyB and decision (merge|split) are required' });
    }
    // Both entities must exist in what the caller can read, so decisions cannot be used to probe hidden names.
    const { entities } = await currentEntities(req);
    const known = new Set(entities.flatMap((e) => e.keys));
    if (!known.has(keyA) || !known.has(keyB)) return res.status(404).json({ error: 'Entity not found' });

    const pair = { projectId: req.project._id, $or: [{ keyA, keyB }, { keyA: keyB, keyB: keyA }] };
    await EntityDecision.deleteMany(pair);
    await EntityDecision.create({ projectId: req.project._id, keyA, keyB, decision, decidedBy: req.userId });
    await record(req.userId, 'ENTITY_DECISION', `project:${req.project._id}`, { decision });
    res.json(await currentEntities(req));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

const unitRef = (u, docs) => u && ({ unitId: u._id, documentId: u.documentId, filename: docs.get(String(u.documentId))?.filename, ordinal: u.ordinal, loc: u.loc, classification: u.classification });

// GET /api/projects/:projectId/conflicts?status=open|confirmed|dismissed
async function listConflicts(req, res) {
  try {
    const query = { projectId: req.project._id, classification: { $lte: req.clearance } };
    if (['open', 'confirmed', 'dismissed'].includes(req.query.status)) query.status = req.query.status;
    const conflicts = await Conflict.find(query).sort({ detectedAt: -1 }).lean();

    const unitIds = conflicts.flatMap((c) => [c.unitA, c.unitB]);
    const [units, docs] = await Promise.all([
      EvidenceUnit.find({ _id: { $in: unitIds } }).select('documentId ordinal loc classification').lean(),
      visibleDocs(req),
    ]);
    const byUnit = new Map(units.map((u) => [String(u._id), u]));
    const byDoc = new Map(docs.map((d) => [String(d._id), d]));

    await record(req.userId, 'CONFLICTS_READ', `project:${req.project._id}`, { clearance: req.clearance, count: conflicts.length });
    res.json(conflicts.map((c) => ({
      id: c._id, kind: c.kind, field: c.field, supportA: c.supportA, supportB: c.supportB, explanation: c.explanation, status: c.status, detectedAt: c.detectedAt, classification: c.classification,
      a: { ...unitRef(byUnit.get(String(c.unitA)), byDoc), value: c.valueA, quote: c.quoteA },
      b: { ...unitRef(byUnit.get(String(c.unitB)), byDoc), value: c.valueB, quote: c.quoteB },
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// PATCH /api/projects/:projectId/conflicts/:conflictId  { status }
async function reviewConflict(req, res) {
  try {
    const { status } = req.body;
    if (!['open', 'confirmed', 'dismissed'].includes(status)) return res.status(400).json({ error: 'status must be open, confirmed or dismissed' });
    if (!mongoose.Types.ObjectId.isValid(req.params.conflictId)) return res.status(404).json({ error: 'Conflict not found' });
    const conflict = await Conflict.findOneAndUpdate(
      { _id: req.params.conflictId, projectId: req.project._id, classification: { $lte: req.clearance } },
      { $set: { status, reviewedBy: req.userId, reviewedAt: new Date() } },
      { new: true },
    );
    if (!conflict) {
      await record(req.userId, 'ACCESS_DENIED', `conflict:${req.params.conflictId}`);
      return res.status(404).json({ error: 'Conflict not found' });
    }
    await record(req.userId, 'CONFLICT_REVIEW', `conflict:${conflict._id}`, { status });
    res.json({ id: conflict._id, status: conflict.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/projects/:projectId/gaps — values a source states that were not turned into a comparable fact
async function listGaps(req, res) {
  try {
    const [units, docs] = await Promise.all([
      EvidenceUnit.find({ projectId: req.project._id, classification: { $lte: req.clearance }, 'factGaps.0': { $exists: true } })
        .select('text documentId ordinal loc classification factGaps').sort({ documentId: 1, ordinal: 1 }).limit(200).lean(),
      visibleDocs(req),
    ]);
    const byDoc = new Map(docs.map((d) => [String(d._id), d]));
    await record(req.userId, 'GAPS_READ', `project:${req.project._id}`, { clearance: req.clearance });
    res.json(units.map((u) => ({ ...unitRef(u, byDoc), text: u.text, values: u.factGaps })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/projects/:projectId/facts — the (subject, field, value) facts read from the sources the caller may read
async function listFacts(req, res) {
  try {
    const [units, docs] = await Promise.all([
      EvidenceUnit.find({ projectId: req.project._id, classification: { $lte: req.clearance }, 'facts.0': { $exists: true } })
        .select('documentId ordinal loc classification facts').sort({ documentId: 1, ordinal: 1 }).lean(),
      visibleDocs(req),
    ]);
    const byDoc = new Map(docs.map((d) => [String(d._id), d]));
    await record(req.userId, 'FACTS_READ', `project:${req.project._id}`, { clearance: req.clearance });
    res.json(units.flatMap((u) => u.facts.map((f) => ({ ...f, ...unitRef(u, byDoc) }))));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/projects/:projectId/duplicates
async function listDuplicates(req, res) {
  try {
    const [units, docs] = await Promise.all([
      EvidenceUnit.find({ projectId: req.project._id, classification: { $lte: req.clearance } }).select('text documentId ordinal loc classification').lean(),
      visibleDocs(req),
    ]);
    const byDoc = new Map(docs.map((d) => [String(d._id), d]));
    const groups = findDuplicates(units).slice(0, 100).map((g) => ({
      kind: g.kind, documents: g.documents, classification: g.classification, count: g.units.length,
      text: g.units[0].text,
      units: g.units.slice(0, 50).map((u) => ({ ...unitRef(u, byDoc), text: u.text })),
    }));
    await record(req.userId, 'DUPLICATES_READ', `project:${req.project._id}`, { clearance: req.clearance });
    res.json(groups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/projects/:projectId/entity-graph — documents, entities and conflicts the caller may read
async function entityGraph(req, res) {
  try {
    const [{ entities }, docs, conflicts] = await Promise.all([
      currentEntities(req),
      visibleDocs(req),
      Conflict.find({ projectId: req.project._id, status: { $ne: 'dismissed' }, classification: { $lte: req.clearance } }).lean(),
    ]);
    const docIds = new Set(docs.map((d) => String(d._id)));
    const top = entities.slice(0, 60);

    const nodes = [
      ...docs.map((d) => ({ id: `doc:${d._id}`, type: 'document', label: d.filename, val: 8, classification: d.classification })),
      ...top.map((e) => ({ id: `ent:${e.id}`, type: 'entity', label: e.canonical, val: 4 + Math.min(e.mentionCount, 12), entityType: e.type, aliases: e.aliases, classification: e.classification })),
      ...conflicts.map((c) => ({ id: `con:${c._id}`, type: 'conflict', label: c.field || 'conflict', val: 7, fullText: `${c.valueA} ↔ ${c.valueB}. ${c.explanation || ''}`, classification: c.classification })),
    ];
    const links = [];
    for (const e of top) {
      const perDoc = new Map();
      e.mentions.forEach((m) => perDoc.set(m.docId, (perDoc.get(m.docId) || 0) + 1));
      perDoc.forEach((count, docId) => { if (docIds.has(docId)) links.push({ source: `ent:${e.id}`, target: `doc:${docId}`, type: 'mentioned_in', weight: count }); });
    }
    conflicts.forEach((c) => {
      [c.docA, c.docB].forEach((d) => { if (docIds.has(String(d))) links.push({ source: `con:${c._id}`, target: `doc:${d}`, type: 'contradicts', weight: 3, explanation: { snippet: `${c.quoteA} ↔ ${c.quoteB}` } }); });
    });

    await record(req.userId, 'GRAPH_READ', `project:${req.project._id}`, { view: 'entities', clearance: req.clearance });
    res.json({ nodes, links, meta: { entityCount: entities.length, conflictCount: conflicts.length, documentCount: docs.length } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { listFacts, listGaps, runAnalysisRoute, analysisStatus, listEntities, decideEntities, listConflicts, reviewConflict, listDuplicates, entityGraph };
