// Turns a draft into an immutable, signed export: a PDF plus a provenance manifest that maps every statement to
// the exact source passages and records the source-file hashes, so any later change can be detected.
const axios = require('axios');
const crypto = require('crypto');
const Export = require('../models/Export');
const Document = require('../models/Document');
const EvidenceUnit = require('../models/EvidenceUnit');
const Audit = require('../models/Audit');
const storage = require('./storage');
const signing = require('./signing');
const { quoteInText } = require('./claims');
const { record } = require('./audit');
const { viewFor } = require('./draftView');
const { CLASSIFICATIONS } = require('../sourceTypes');
const { describeLocation } = require('../utils/locations');

const WORKER_URL = process.env.WORKER_URL || 'http://localhost:8000';
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

function merkleRoot(hashes) {
  let level = [...hashes].sort();
  if (!level.length) return sha256('');
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(sha256(level[i] + (level[i + 1] || level[i])));
    level = next;
  }
  return level[0];
}

async function exportDraft({ draft, userId, clearance, includeUnverified = false }) {
  if (draft.status !== 'READY') throw Object.assign(new Error('The document is not ready to export'), { status: 409 });
  const view = viewFor(draft, clearance);

  // Which statements go in: verified ones, conflicts, and clearly-marked analyst notes. Unsupported ones only on request.
  const wanted = (c) => ['supported', 'conflicted', 'human'].includes(c.status) || (includeUnverified && c.status === 'unsupported');
  // A finding with no cited evidence can never be exported as one, whatever its stored status says.
  const unsourced = (c) => ['supported', 'conflicted'].includes(c.status) && c.evidence.length === 0;
  const candidates = view.sections.flatMap((s) => s.claims.filter((c) => wanted(c) && !unsourced(c)));

  // Re-check the evidence right now: a unit that changed since verification invalidates the statement.
  const unitIds = [...new Set(candidates.flatMap((c) => c.evidence.map((e) => String(e.unitId))))];
  const units = new Map((await EvidenceUnit.find({ _id: { $in: unitIds } }).select('text textSha256 documentId classification loc ordinal').lean()).map((u) => [String(u._id), u]));
  const stale = [];
  const fresh = (c) => c.evidence.every((e) => {
    const u = units.get(String(e.unitId));
    return u && u.classification <= clearance && u.textSha256 === e.unitSha256 && sha256(u.text) === u.textSha256 && quoteInText(e.quote, u.text);
  });
  const included = new Set(candidates.filter((c) => (fresh(c) ? true : (stale.push(c.id), false))).map((c) => c.id));

  const docIds = [...new Set([...included].length ? candidates.filter((c) => included.has(c.id)).flatMap((c) => c.evidence.map((e) => String(e.documentId))) : [])];
  const docs = new Map((await Document.find({ _id: { $in: docIds } }).lean()).map((d) => [String(d._id), d]));
  for (const d of docs.values()) {
    const key = storage.keyFromUrl(d.fileUrl);
    if (!key || (await storage.sha256(key)) !== d.sha256) {
      throw Object.assign(new Error(`Source "${d.filename}" no longer matches its recorded hash; refusing to export`), { status: 409 });
    }
  }

  // Citation numbers, in order of first appearance
  const numbers = new Map();
  const citations = [];
  const cite = (e) => {
    const k = String(e.unitId);
    if (!numbers.has(k)) {
      const u = units.get(k);
      const d = docs.get(String(u.documentId));
      numbers.set(k, numbers.size + 1);
      citations.push({ n: numbers.size, unitId: k, documentId: String(u.documentId), filename: d.filename, loc: u.loc, classification: u.classification, unitSha256: u.textSha256, quote: e.quote });
    }
    return numbers.get(k);
  };

  const manifestClaims = [];
  const builtSections = view.sections.map((s) => {
    const items = s.claims.filter((c) => included.has(c.id)).map((c) => {
      const cites = [...new Set(c.evidence.map(cite))];
      manifestClaims.push({
        id: c.id, section: s.heading, text: c.text, status: c.status, authored: c.authored, edited: !!c.edited, classification: c.classification,
        entailment: c.entailment ?? null, conflictIds: c.conflictIds,
        evidence: c.evidence.map((e) => ({ n: numbers.get(String(e.unitId)), unitId: String(e.unitId), documentId: String(e.documentId), quote: e.quote, quoteSha256: sha256(e.quote), unitSha256: e.unitSha256 })),
      });
      return { text: c.text, status: c.status, cites };
    });
    return { key: s.key, heading: s.heading, items: s.redacted ? [...items, { redacted: true, count: s.redacted }] : items };
  });

  // Sections built from the report's records rather than written by the model
  const line = (text) => ({ text, status: 'supported', cites: [] });
  const cov = view.coverage;
  const sections = builtSections.map((s) => {
    if (s.key === 'scope' && cov) {
      const rows = cov.documents.map((d) => line(`${d.filename} (${d.sourceType}, ${CLASSIFICATIONS[d.classification]}, ${d.units} evidence units).`));
      return { ...s, items: rows.length ? [...rows, ...(cov.hiddenDocuments ? [{ redacted: true, count: cov.hiddenDocuments }] : [])] : s.items };
    }
    if (s.key === 'gaps' && cov) {
      const items = cov.gaps.examples.map((g) => line(`${g.filename}: ${g.text}`));
      return { ...s, items: [line(`${cov.gaps.total} passage(s) state times, counts or dates that were not matched to any other source.`), ...items] };
    }
    if (s.key === 'provenance') {
      return { ...s, items: [
        line(`Every statement above is mapped to its source passage in the signed manifest accompanying this PDF (key ${signing.keyId()}).`),
        ...citations.map((c) => line(`[${c.n}] ${c.filename}, ${describeLocation(c.loc)}, passage hash ${c.unitSha256.slice(0, 16)}…`)),
      ] };
    }
    return s;
  });

  const excluded = view.sections.flatMap((s) => s.claims.filter((c) => !included.has(c.id)).map((c) => ({
    id: c.id, status: stale.includes(c.id) ? 'stale-evidence' : unsourced(c) ? 'missing-evidence' : c.status, textSha256: sha256(c.text),
  })));
  const level = manifestClaims.reduce((m, c) => Math.max(m, c.classification), 0);
  const summary = {
    supported: manifestClaims.filter((c) => c.status === 'supported').length,
    conflicted: manifestClaims.filter((c) => c.status === 'conflicted').length,
    human: manifestClaims.filter((c) => c.status === 'human').length,
    unsupportedIncluded: manifestClaims.filter((c) => c.status === 'unsupported').length,
    excluded: excluded.length, redacted: view.redacted,
  };

  const exportId = crypto.randomUUID();
  const classificationName = CLASSIFICATIONS[level];
  const sources = [...new Set(citations.map((c) => c.documentId))].map((id) => {
    const d = docs.get(id);
    return { documentId: id, filename: d.filename, sourceType: d.sourceType, classification: d.classification, sha256: d.sha256 };
  });

  // PDF
  const spec = {
    title: view.title, templateLabel: (require('./draftGenerator').TEMPLATES[view.template] || {}).label || '', generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC', classificationName, exportId, keyId: signing.keyId(),
    summary: { ...summary, excluded: summary.excluded },
    sections,
    sources: citations.map((c) => ({ n: c.n, filename: c.filename, location: describeLocation(c.loc), classificationName: CLASSIFICATIONS[c.classification], quote: c.quote, sha256: sources.find((s) => s.documentId === c.documentId).sha256.slice(0, 16) + '…' })),
  };
  let rendered;
  try {
    ({ data: rendered } = await axios.post(`${WORKER_URL}/render-pdf`, { spec }, { timeout: 120000 }));
  } catch (err) {
    throw Object.assign(new Error(`PDF rendering failed: ${err.response?.data?.detail || err.message}`), { status: 502 });
  }
  if (!storage.isValidKey(rendered.storageKey)) throw Object.assign(new Error('PDF rendering returned an invalid file'), { status: 502 });
  const pdfSha = await storage.sha256(rendered.storageKey);

  // Manifest, signed
  const head = await Audit.findOne().sort({ seq: -1 }).select('seq hash').lean();
  // Round-trip through JSON so what is signed is exactly what is stored (no Date/ObjectId objects, no undefined).
  const manifest = JSON.parse(JSON.stringify({
    version: 1, exportId, project: String(draft.projectId),
    document: { title: draft.title, template: draft.template, draftId: String(draft._id), draftVersion: draft.version, generatedAt: draft.generatedAt },
    exportedAt: new Date().toISOString(), reader: { userId: String(userId), clearance },
    classification: level, classificationName, redactions: view.redacted,
    generation: { ...draft.model, stats: view.stats },
    claims: manifestClaims, excluded, citations, sources, sourceMerkleRoot: merkleRoot(sources.map((s) => s.sha256)),
    pdf: { sha256: pdfSha, pages: rendered.pages },
    audit: head ? { seq: head.seq, hash: head.hash } : null,
    keyId: signing.keyId(),
  }));
  const file = Buffer.from(JSON.stringify({ manifest, signature: signing.sign(manifest) }, null, 2));
  const stored = await storage.put(file, 'manifest.json');

  const exp = await Export.create({
    projectId: draft.projectId, draftId: draft._id, draftVersion: draft.version, exportedBy: String(userId), clearance, classification: level,
    pdfKey: rendered.storageKey, manifestKey: stored.key, pdfSha256: pdfSha, manifestSha256: stored.sha256, pages: rendered.pages, summary,
  });
  await record(userId, 'DRAFT_EXPORT', `draft:${draft._id}`, { exportId: String(exp._id), draftVersion: draft.version, clearance, classification: level, pdfSha256: pdfSha, manifestSha256: stored.sha256, ...summary });
  return exp;
}

module.exports = { exportDraft, merkleRoot, sha256 };
