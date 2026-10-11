const axios = require('axios');
const EvidenceUnit = require('../models/EvidenceUnit');
const Document = require('../models/Document');
const Conflict = require('../models/Conflict');
const Project = require('../models/Project');
const crypto = require('crypto');
const FactJudgement = require('../models/FactJudgement');
const { buildConflicts, compareText } = require('./facts');
const { deriveLogFacts, isNotable } = require('./logFacts');
const { judgeText } = require('./factJudge');
const { resolveEntities, entityLookup } = require('./entityResolution');
const { cosineSimilarity } = require('../utils/similarity');
const { record } = require('./audit');
const { worthFacts, worthEntities, interleaveByDocument, selectWorthy, SMALL_DOCUMENT_UNITS } = require('./analysisFilters');

const WORKER_URL = process.env.WORKER_URL || 'http://localhost:8000';
const MENTION_BATCH = 10;   // small requests: a slow model finishes each one, and progress shows
const FACT_BATCH = 5;  // matches the worker's own batch: one model call per pass
const EVENT_BATCH = 100;
const MAX_EVENTS_PER_RUN = 400;   // log events labelled per run; the rest wait for the next run
const MAX_ENTITY_UNITS_PER_RUN = Number(process.env.ANALYSIS_MAX_ENTITY_UNITS || 30);  // model-read units per run for entities
const MAX_FACT_UNITS_PER_RUN = Number(process.env.ANALYSIS_MAX_FACT_UNITS || 40);      // model-read units per run for facts
const MODEL_STEP_TIMEOUT_MS = Number(process.env.ANALYSIS_STEP_TIMEOUT_MS || 480000); // one worker request; a slower model skips the rest of the step
const MAX_JUDGED_PER_RUN = 30;    // free-text value pairs sent to the model per run
const worker = (path, body, timeout = 600000) => axios.post(`${WORKER_URL}${path}`, body, { timeout }).then((r) => r.data);

async function setProgress(projectId, patch) {
  const set = {};
  for (const [k, v] of Object.entries(patch)) set[`analysis.${k}`] = v;
  await Project.updateOne({ _id: projectId }, { $set: set });
}

// Step 1: entity mentions for every readable unit that has none yet. Patterns (hosts, IPs, IDs, emails, log fields) run
// for every unit; the model reads only prose that could name something, up to a per-run budget. Run again to continue.
async function extractMentions(projectId, clearance, docs) {
  const pending = await EvidenceUnit.find({ projectId, classification: { $lte: clearance }, mentionsAt: { $exists: false } })
    .select('text fields documentId').sort({ documentId: 1, ordinal: 1 }).lean();
  const isProse = (u) => docs.get(String(u.documentId))?.sourceType !== 'syslog';
  const worthy = new Set(selectWorthy(pending.filter(isProse), worthEntities).map((u) => String(u._id)));
  const candidates = pending.filter((u) => worthy.has(String(u._id)));
  const modelReads = new Set(interleaveByDocument(candidates).slice(0, MAX_ENTITY_UNITS_PER_RUN).map((u) => String(u._id)));
  const deferred = candidates.length - modelReads.size;
  // everything except prose that is waiting for a later run gets processed now (pattern-only for units the model skips)
  const todo = pending.filter((u) => !worthy.has(String(u._id)) || modelReads.has(String(u._id)));
  await setProgress(projectId, { phase: 'finding entities', done: 0, total: todo.length });

  for (let i = 0; i < todo.length; i += MENTION_BATCH) {
    const batch = todo.slice(i, i + MENTION_BATCH);
    let data;
    try {
      data = await worker('/extract', {
        units: batch.map((u) => ({ id: String(u._id), text: u.text, fields: u.fields || {}, sourceType: docs.get(String(u.documentId))?.sourceType || '', llm: modelReads.has(String(u._id)) })),
      }, MODEL_STEP_TIMEOUT_MS);
    } catch (err) {
      return { read: i, deferred: deferred + (todo.length - i), incomplete: err.message };
    }
    await EvidenceUnit.bulkWrite(data.results.map((r) => ({
      updateOne: { filter: { _id: r.id, projectId }, update: { $set: { mentions: r.mentions, mentionsAt: new Date() } } },
    })));
    await setProgress(projectId, { done: Math.min(i + MENTION_BATCH, todo.length) });
  }
  return { read: todo.length, deferred };
}

// Step 2: (subject, field, value) facts from prose units. Log lines are structured events, not statements
// to compare, so they are skipped here. The field vocabulary is fed back so sources use the same names.
// Only sentences that state a number, date or time reach the model, up to a per-run budget; the rest are marked done.
async function extractFacts(projectId, clearance, docs) {
  const proseDocs = [...docs.values()].filter((d) => d.sourceType !== 'syslog').map((d) => d._id);
  const all = await EvidenceUnit.find({ projectId, documentId: { $in: proseDocs }, classification: { $lte: clearance }, factsAt: { $exists: false } })
    .select('text documentId').sort({ documentId: 1, ordinal: 1 }).lean();
  const worthySet = new Set(selectWorthy(all, worthFacts).map((u) => String(u._id)));
  const skip = all.filter((u) => !worthySet.has(String(u._id)));
  if (skip.length) {
    await EvidenceUnit.updateMany({ _id: { $in: skip.map((u) => u._id) } }, { $set: { facts: [], factsAt: new Date(), factGaps: [] } });
  }
  const worthy = interleaveByDocument(all.filter((u) => worthySet.has(String(u._id))));
  const pending = worthy.slice(0, MAX_FACT_UNITS_PER_RUN);
  await setProgress(projectId, { phase: 'reading facts', done: 0, total: pending.length });

  let vocabulary = await EvidenceUnit.distinct('facts.field', { projectId, classification: { $lte: clearance } });
  for (let i = 0; i < pending.length; i += FACT_BATCH) {
    const batch = pending.slice(i, i + FACT_BATCH);
    let data;
    try {
      data = await worker('/extract-facts', { units: batch.map((u) => ({ id: String(u._id), text: u.text })), knownFields: vocabulary }, MODEL_STEP_TIMEOUT_MS);
    } catch (err) {
      return { read: i, deferred: worthy.length - i, incomplete: err.message };
    }
    vocabulary = data.vocabulary;
    await EvidenceUnit.bulkWrite(data.results.map((r) => ({
      updateOne: { filter: { _id: r.id, projectId }, update: { $set: { facts: r.facts, factsAt: new Date(), factGaps: r.gaps || [] } } },
    })));
    await setProgress(projectId, { done: Math.min(i + FACT_BATCH, pending.length) });
  }
  return { read: pending.length, deferred: worthy.length - pending.length };
}

// Step 3: label which log events mark a milestone named in the prose facts (the model only names the
// milestone; the time is the event's own timestamp).
async function labelEvents(projectId, clearance, docs) {
  const logDocs = [...docs.values()].filter((d) => d.sourceType === 'syslog').map((d) => d._id);
  if (!logDocs.length) return { labelled: 0, pending: 0 };

  const proseUnits = await EvidenceUnit.find({ projectId, classification: { $lte: clearance }, 'facts.type': { $in: ['time', 'datetime'] } }).select('facts').lean();
  const milestones = [...new Set(proseUnits.flatMap((u) => u.facts.filter((f) => ['time', 'datetime'].includes(f.type)).map((f) => f.field)))].sort().slice(0, 40);
  if (!milestones.length) return { labelled: 0, pending: 0 };
  const vocab = crypto.createHash('sha1').update(milestones.join('|')).digest('hex').slice(0, 12);

  const candidates = (await EvidenceUnit.find({ projectId, documentId: { $in: logDocs }, classification: { $lte: clearance }, eventVocab: { $ne: vocab }, 'loc.ts': { $exists: true } })
    .select('text fields loc').sort({ documentId: 1, ordinal: 1 }).lean()).filter(isNotable);
  // round-robin across log files so a large log cannot use the whole budget before a small one is reached
  const todo = interleaveByDocument(candidates).slice(0, MAX_EVENTS_PER_RUN);
  await setProgress(projectId, { phase: 'labelling log events', done: 0, total: todo.length });

  let labelled = 0;
  for (let i = 0; i < todo.length; i += EVENT_BATCH) {
    const batch = todo.slice(i, i + EVENT_BATCH);
    const data = await worker('/label-events', { milestones, events: batch.map((u) => ({ id: String(u._id), text: u.text, host: u.fields?.host || '' })) });
    await EvidenceUnit.bulkWrite(data.results.map((r) => ({
      updateOne: { filter: { _id: r.id, projectId }, update: { $set: { eventField: r.milestone || null, eventVocab: vocab } } },
    })));
    labelled += data.results.filter((r) => r.milestone).length;
    await setProgress(projectId, { done: Math.min(i + EVENT_BATCH, todo.length) });
  }
  return { labelled, pending: candidates.length - todo.length };
}

// Step 4: compare facts across sources. Numbers, times and dates are compared in code; named values go through
// entity resolution; only leftover free-text pairs reach the model (capped, order-swapped, cached).
async function detectConflicts(projectId, clearance) {
  await setProgress(projectId, { phase: 'comparing sources', done: 0, total: 1 });
  const units = await EvidenceUnit.find({ projectId, classification: { $lte: clearance }, $or: [{ 'facts.0': { $exists: true } }, { eventField: { $type: 'string' } }] })
    .select('documentId textSha256 classification mentions facts eventField fields loc text').lean();
  const entries = [
    ...units.flatMap((u) => (u.facts || []).map((fact) => ({ unit: u, fact }))),
    ...deriveLogFacts(units.filter((u) => u.eventField)),
  ];

  // Embeddings help recognise that two differently-worded field names mean the same thing.
  let embeddings;
  const names = [...new Set(entries.map((e) => e.fact.field))].slice(0, 500);
  if (names.length > 1) {
    try {
      const { embeddings: vectors } = await worker('/embed-many', { texts: names }, 60000);
      embeddings = new Map(names.map((n, i) => [n, vectors[i]]));
    } catch (err) {
      console.warn('Field embeddings unavailable, matching by wording only:', err.message);
    }
  }
  // Long documents (papers, manuals) mention many different things with the same field name, so their facts are
  // compared only when both are about the same specific subject.
  const sizes = await EvidenceUnit.aggregate([{ $match: { projectId, classification: { $lte: clearance } } }, { $group: { _id: '$documentId', n: { $sum: 1 } } }]);
  const strictDocs = new Set(sizes.filter((d) => d.n > SMALL_DOCUMENT_UNITS).map((d) => String(d._id)));
  const opts = { embeddings, cosine: cosineSimilarity, strictDocs };

  const mentions = (await EvidenceUnit.find({ projectId, classification: { $lte: clearance }, mentionsAt: { $exists: true } }).select('mentions documentId classification').lean())
    .flatMap((u) => u.mentions.map((m) => ({ text: m.text, type: m.type, unitId: u._id, docId: u.documentId, classification: u.classification })));
  const entityOf = entityLookup(resolveEntities(mentions).entities);

  const found = [...buildConflicts(entries, opts)];
  const text = compareText(entries, { ...opts, entityOf });
  found.push(...text.conflicts);

  // narrow model check on the remaining free-text pairs
  const cached = new Map((await FactJudgement.find({ projectId, pairKey: { $in: text.candidates.map((c) => c.pairKey) } }).lean()).map((j) => [j.pairKey, j]));
  let judged = 0;
  for (const c of text.candidates) {
    let verdict = cached.get(c.pairKey);
    if (!verdict && judged < MAX_JUDGED_PER_RUN) {
      judged++;
      const result = await judgeText({ field: c.field, subject: c.a.fact.subject || c.b.fact.subject, a: c.a.fact, b: c.b.fact });
      verdict = await FactJudgement.findOneAndUpdate({ projectId, pairKey: c.pairKey }, { $set: result }, { upsert: true, new: true });
    }
    if (verdict?.contradict) {
      found.push({ ...c, kind: 'status', explanation: `Sources give different values for ${c.field}: "${c.a.fact.value}" vs "${c.b.fact.value}". ${verdict.reason}`.trim() });
    }
  }

  const keys = found.map((c) => c.pairKey);
  for (const c of found) {
    const fromLog = [c.a, c.b].some((x) => x.fact.source === 'log');
    await Conflict.updateOne({ projectId, pairKey: c.pairKey }, { $set: {
      unitA: c.a.unit._id, unitB: c.b.unit._id, docA: c.a.unit.documentId, docB: c.b.unit.documentId,
      classification: Math.max(c.a.unit.classification, c.b.unit.classification),
      kind: c.kind, field: c.field, valueA: c.a.fact.value, valueB: c.b.fact.value,
      quoteA: c.a.fact.quote, quoteB: c.b.fact.quote, supportA: c.supportA, supportB: c.supportB,
      explanation: fromLog ? `${c.explanation} (a system-log event is one side: the earliest/latest matching event on that host.)` : c.explanation,
    }, $setOnInsert: { detectedAt: new Date() } }, { upsert: true });
  }
  // A conflict that no longer holds (e.g. a source was removed) disappears unless a person already reviewed it.
  await Conflict.deleteMany({ projectId, status: 'open', classification: { $lte: clearance }, pairKey: { $nin: keys } });
  await setProgress(projectId, { done: 1 });
  return { factsCompared: entries.length, conflictsFound: found.length, unitsScanned: units.length, textPairsJudged: judged, textPairsPending: Math.max(0, text.candidates.filter((c) => !cached.has(c.pairKey)).length - judged) };
}

/** Runs in the background after the API has responded. Reads only units at or below `clearance`. */
async function runAnalysis({ projectId, userId, clearance }) {
  try {
    const list = await Document.find({ projectId, status: 'DONE', classification: { $lte: clearance } }).select('filename sourceType').lean();
    const docs = new Map(list.map((d) => [String(d._id), d]));
    const mentions = await extractMentions(projectId, clearance, docs);
    const facts = await extractFacts(projectId, clearance, docs);
    const events = await labelEvents(projectId, clearance, docs);
    const detection = await detectConflicts(projectId, clearance);
    const gapUnits = await EvidenceUnit.countDocuments({ projectId, classification: { $lte: clearance }, 'factGaps.0': { $exists: true } });
    const stats = { unitsWithNewMentions: mentions.read, unitsWithNewFacts: facts.read, entityUnitsPending: mentions.deferred, factUnitsPending: facts.deferred, incomplete: mentions.incomplete || facts.incomplete || '', logEventsLabelled: events.labelled, logEventsPending: events.pending, unitsWithUncomparedValues: gapUnits, ...detection, clearance };
    await setProgress(projectId, { status: 'DONE', phase: '', finishedAt: new Date(), error: '', stats });
    await record(userId, 'ANALYSIS_DONE', `project:${projectId}`, stats);
  } catch (err) {
    console.error('Analysis failed:', err.message);
    await setProgress(projectId, { status: 'ERROR', phase: '', finishedAt: new Date(), error: err.message });
    await record('system', 'ANALYSIS_ERROR', `project:${projectId}`, { error: err.message });
  }
}

/** Atomically claims the project's single analysis slot; returns false when one is already running. */
async function startAnalysis({ project, userId, clearance }) {
  const claimed = await Project.findOneAndUpdate(
    { _id: project._id, 'analysis.status': { $ne: 'RUNNING' } },
    { $set: { analysis: { status: 'RUNNING', phase: 'starting', done: 0, total: 0, startedAt: new Date(), error: '', stats: {} } } },
  );
  if (!claimed) return false;
  await record(userId, 'ANALYSIS_START', `project:${project._id}`, { clearance });
  runAnalysis({ projectId: project._id, userId, clearance });
  return true;
}

module.exports = { startAnalysis, runAnalysis };
