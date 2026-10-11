const crypto = require('crypto');
const fs = require('fs');
const mongoose = require('mongoose');
const multer = require('multer');
const Draft = require('../models/Draft');
const Export = require('../models/Export');
const Document = require('../models/Document');
const EvidenceUnit = require('../models/EvidenceUnit');
const storage = require('../services/storage');
const signing = require('../services/signing');
const { generateDraft, summarize, TEMPLATES } = require('../services/draftGenerator');
const { viewFor } = require('../services/draftView');
const { exportDraft } = require('../services/exporter');
const { verifyExport } = require('../services/verifier');
const { checkClaim, NliUnavailable } = require('../services/nli');
const { quoteInText } = require('../services/claims');
const { record } = require('../services/audit');

const isId = (v) => mongoose.Types.ObjectId.isValid(v);
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const MAX_CLAIM_CHARS = 600;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// router.param('draftId'): the draft must belong to the (already ownership-checked) project.
async function loadDraft(req, res, next, id) {
  try {
    const draft = isId(id) && (await Draft.findById(id));
    if (!draft || String(draft.projectId) !== String(req.project._id)) return res.status(404).json({ error: 'Document not found' });
    req.draft = draft;
    next();
  } catch (err) { next(err); }
}

const fail = (res, err) => {
  if (err instanceof NliUnavailable) return res.status(503).json({ error: err.message });
  return res.status(err.status || 500).json({ error: err.status ? err.message : 'Server error' });
};

// GET /api/projects/:projectId/drafts/templates
const listTemplates = (req, res) => res.json(Object.entries(TEMPLATES).map(([key, t]) => ({ key, label: t.label, description: t.description, bestFor: t.bestFor, sections: t.sections.map((s) => s.heading) })));

// GET /api/projects/:projectId/drafts
async function listDrafts(req, res) {
  const drafts = await Draft.find({ projectId: req.project._id }).sort({ createdAt: -1 });
  res.json(drafts.map((d) => {
    const v = viewFor(d, req.clearance);
    return { id: v.id, title: v.title, template: v.template, status: v.status, error: v.error, progress: v.progress, version: v.version, createdAt: v.createdAt, stats: v.stats, classification: v.classification, redacted: v.redacted };
  }));
}

// POST /api/projects/:projectId/drafts
async function createDraft(req, res) {
  try {
    const { title, template = 'incident', focus = '' } = req.body;
    if (!title || !String(title).trim()) return res.status(400).json({ error: 'title is required' });
    if (!TEMPLATES[template]) return res.status(400).json({ error: `template must be one of: ${Object.keys(TEMPLATES).join(', ')}` });

    // Only sources the author may read can be selected.
    const readable = await Document.find({ projectId: req.project._id, status: 'DONE', classification: { $lte: req.clearance } }).select('_id').lean();
    const readableIds = new Set(readable.map((d) => String(d._id)));
    const requested = Array.isArray(req.body.sourceDocIds) ? req.body.sourceDocIds.map(String) : [...readableIds];
    if (requested.some((id) => !readableIds.has(id))) return res.status(404).json({ error: 'A selected source was not found' });
    if (!requested.length) return res.status(400).json({ error: 'Select at least one processed source' });

    const draft = await Draft.create({ projectId: req.project._id, title: String(title).trim(), template, focus: String(focus).slice(0, 300), createdBy: req.userId, sourceDocIds: requested });
    await record(req.userId, 'DRAFT_CREATE', `draft:${draft._id}`, { template, sources: requested.length, clearance: req.clearance });
    generateDraft({ draftId: draft._id, clearance: req.clearance, userId: req.userId });
    res.status(202).json({ id: draft._id, status: 'GENERATING' });
  } catch (err) { fail(res, err); }
}

// GET /api/projects/:projectId/drafts/:draftId
async function getDraft(req, res) {
  const view = viewFor(req.draft, req.clearance);
  if (view.redacted) await record(req.userId, 'ACCESS_DENIED', `draft:${req.draft._id}`, { reason: 'clearance', redacted: view.redacted });
  res.json(view);
}

async function deleteDraft(req, res) {
  await Draft.deleteOne({ _id: req.draft._id });
  await record(req.userId, 'DRAFT_DELETE', `draft:${req.draft._id}`);
  res.json({ message: 'Deleted' });
}

// ── editing ────────────────────────────────────────────────────────────────

function locate(draft, claimId, clearance) {
  for (const section of draft.sections) {
    const claim = section.claims.find((c) => c.id === claimId);
    if (claim) return claim.classification <= clearance ? { section, claim } : null;
  }
  return null;
}

/** Re-verify a statement against its cited evidence after a human changed it. */
async function evaluate(text, evidence, clearance, conflictIds = []) {
  if (!evidence.length) return { status: 'human', classification: clearance, entailment: undefined };
  const units = await EvidenceUnit.find({ _id: { $in: evidence.map((e) => e.unitId) }, classification: { $lte: clearance } }).select('text classification').lean();
  const quotes = new Map(evidence.map((e) => [String(e.unitId), e.quote]));
  const check = await checkClaim(text, units.map((u) => ({ text: u.text, quote: quotes.get(String(u._id)) })));
  return {
    status: !check.supported ? 'unsupported' : conflictIds.length ? 'conflicted' : 'supported',
    classification: units.reduce((m, u) => Math.max(m, u.classification), 0),
    entailment: Math.round(check.entailment * 1000) / 1000,
  };
}

async function commit(req, action, claimId, before, after) {
  const draft = req.draft;
  draft.version += 1;
  draft.revisions.push({ version: draft.version, by: String(req.userId), at: new Date(), action, claimId, beforeSha: before ? sha(before) : undefined, afterSha: after ? sha(after) : undefined });
  draft.stats = { ...draft.stats, ...summarize(draft) };
  await draft.save();
  await record(req.userId, 'DRAFT_EDIT', `draft:${draft._id}`, { action, claimId, version: draft.version, beforeSha: before ? sha(before) : null, afterSha: after ? sha(after) : null });
}

const cleanText = (v) => String(v || '').replace(/\s+/g, ' ').trim();

// PATCH /api/projects/:projectId/drafts/:draftId/claims/:claimId  { text }
async function editClaim(req, res) {
  try {
    const found = locate(req.draft, req.params.claimId, req.clearance);
    if (!found) return res.status(404).json({ error: 'Statement not found' });
    const text = cleanText(req.body.text);
    if (!text || text.length > MAX_CLAIM_CHARS) return res.status(400).json({ error: `text must be 1-${MAX_CLAIM_CHARS} characters` });
    if (found.claim.authored === 'conflict-report') return res.status(400).json({ error: 'Conflict statements are generated from recorded conflicts and cannot be edited; delete or dismiss the conflict instead' });

    const before = found.claim.text;
    const result = await evaluate(text, found.claim.evidence, req.clearance, found.claim.conflictIds);
    Object.assign(found.claim, { text, edited: true, status: result.status, entailment: result.entailment, classification: found.claim.evidence.length ? result.classification : req.clearance });
    await commit(req, 'edit', found.claim.id, before, text);
    res.json({ id: found.claim.id, status: found.claim.status, entailment: found.claim.entailment, version: req.draft.version });
  } catch (err) { fail(res, err); }
}

// POST /api/projects/:projectId/drafts/:draftId/claims  { sectionKey, text, evidence?: [{unitId, quote}] }
async function addClaim(req, res) {
  try {
    const section = req.draft.sections.find((s) => s.key === req.body.sectionKey);
    if (!section) return res.status(400).json({ error: 'Unknown section' });
    const text = cleanText(req.body.text);
    if (!text || text.length > MAX_CLAIM_CHARS) return res.status(400).json({ error: `text must be 1-${MAX_CLAIM_CHARS} characters` });

    const evidence = [];
    for (const e of (Array.isArray(req.body.evidence) ? req.body.evidence : []).slice(0, 3)) {
      const unit = isId(e && e.unitId) && (await EvidenceUnit.findOne({ _id: e.unitId, projectId: req.project._id, documentId: { $in: req.draft.sourceDocIds }, classification: { $lte: req.clearance } }).select('text textSha256 documentId').lean());
      if (!unit) return res.status(404).json({ error: 'Cited passage not found' });
      if (!quoteInText(String(e.quote || ''), unit.text) || String(e.quote).trim().length < 5) return res.status(400).json({ error: 'A quote must be copied exactly from the cited passage' });
      evidence.push({ unitId: unit._id, documentId: unit.documentId, quote: String(e.quote).trim(), unitSha256: unit.textSha256 });
    }
    const result = await evaluate(text, evidence, req.clearance);
    // An unsourced note is labelled at the author's clearance unless they state a lower level explicitly.
    const noteLevel = req.body.classification === undefined ? req.clearance : Number(req.body.classification);
    if (!evidence.length && (!Number.isInteger(noteLevel) || noteLevel < 0 || noteLevel > req.clearance)) {
      return res.status(400).json({ error: `classification must be an integer from 0 to your clearance (${req.clearance})` });
    }
    const claim = { id: crypto.randomUUID(), text, status: result.status, authored: 'human', edited: true, classification: evidence.length ? result.classification : noteLevel, evidence, entailment: result.entailment, conflictIds: [] };
    section.claims.push(claim);
    await commit(req, 'add', claim.id, null, text);
    res.status(201).json({ id: claim.id, status: claim.status, version: req.draft.version });
  } catch (err) { fail(res, err); }
}

// DELETE /api/projects/:projectId/drafts/:draftId/claims/:claimId
async function deleteClaim(req, res) {
  const found = locate(req.draft, req.params.claimId, req.clearance);
  if (!found) return res.status(404).json({ error: 'Statement not found' });
  const before = found.claim.text;
  found.section.claims = found.section.claims.filter((c) => c.id !== found.claim.id);
  req.draft.stats = { ...req.draft.stats, deleted: (req.draft.stats.deleted || 0) + 1 };
  await commit(req, 'delete', req.params.claimId, before, null);
  res.json({ version: req.draft.version });
}

// ── export and download ────────────────────────────────────────────────────

// POST /api/projects/:projectId/drafts/:draftId/export  { includeUnverified? }
async function exportRoute(req, res) {
  try {
    const exp = await exportDraft({ draft: req.draft, userId: req.userId, clearance: req.clearance, includeUnverified: req.body.includeUnverified === true });
    res.status(201).json(exportJson(req.project._id, exp));
  } catch (err) { fail(res, err); }
}

const exportJson = (projectId, e) => ({
  id: e._id, draftVersion: e.draftVersion, clearance: e.clearance, classification: e.classification, pages: e.pages, summary: e.summary, createdAt: e.createdAt,
  pdfSha256: e.pdfSha256, manifestSha256: e.manifestSha256,
  pdfUrl: `/api/projects/${projectId}/exports/${e._id}/pdf`, manifestUrl: `/api/projects/${projectId}/exports/${e._id}/manifest`,
});

async function listExports(req, res) {
  const exports = await Export.find({ draftId: req.draft._id, classification: { $lte: req.clearance } }).sort({ createdAt: -1 });
  res.json(exports.map((e) => exportJson(req.project._id, e)));
}

// GET /api/projects/:projectId/exports/:exportId/(pdf|manifest)
const download = (kind) => async (req, res) => {
  try {
    const exp = isId(req.params.exportId) && (await Export.findOne({ _id: req.params.exportId, projectId: req.project._id }));
    if (!exp || exp.classification > req.clearance) {
      if (exp) await record(req.userId, 'ACCESS_DENIED', `export:${exp._id}`, { reason: 'clearance' });
      return res.status(404).json({ error: 'Export not found' });
    }
    const key = kind === 'pdf' ? exp.pdfKey : exp.manifestKey;
    if (!(await storage.exists(key))) return res.status(404).json({ error: 'Export file is missing' });
    await record(req.userId, 'EXPORT_DOWNLOAD', `export:${exp._id}`, { kind });
    res.setHeader('Content-Type', kind === 'pdf' ? 'application/pdf' : 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${kind === 'pdf' ? 'document.pdf' : 'manifest.json'}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    fs.createReadStream(storage.pathFor(key)).pipe(res);
  } catch (err) { fail(res, err); }
};

// POST /api/verify  (multipart: manifest, pdf?)
const verifyRoute = [
  upload.fields([{ name: 'manifest', maxCount: 1 }, { name: 'pdf', maxCount: 1 }]),
  async (req, res) => {
    try {
      const manifest = req.files?.manifest?.[0];
      if (!manifest) return res.status(400).json({ error: 'manifest file is required' });
      const result = await verifyExport({ manifestBuffer: manifest.buffer, pdfBuffer: req.files?.pdf?.[0]?.buffer, userId: req.userId, clearance: req.clearance });
      await record(req.userId, 'EXPORT_VERIFY', 'manifest', { valid: result.valid, failed: result.failed });
      res.json(result);
    } catch (err) { fail(res, err); }
  },
];

const signingKey = (req, res) => res.json({ keyId: signing.keyId(), alg: 'ed25519', publicKeyPem: signing.publicKeyPem() });

module.exports = { loadDraft, listTemplates, listDrafts, createDraft, getDraft, deleteDraft, editClaim, addClaim, deleteClaim, exportRoute, listExports, download, verifyRoute, signingKey };
