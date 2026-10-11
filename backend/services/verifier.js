// Independent re-check of a signed export against the manifest, the PDF, and what is stored now.
const Document = require('../models/Document');
const Project = require('../models/Project');
const EvidenceUnit = require('../models/EvidenceUnit');
const Audit = require('../models/Audit');
const storage = require('./storage');
const signing = require('./signing');
const { verifyChain } = require('./audit');
const { quoteInText } = require('./claims');
const { sha256, merkleRoot } = require('./exporter');

const MAX_CHECKS = 400;

/** Statements that may stand as findings must cite a source. */
const needsSource = (c) => ['supported', 'conflicted'].includes(c.status);

async function verifyExport({ manifestBuffer, pdfBuffer, userId, clearance }) {
  const checks = [];
  const add = (name, ok, detail = '', skipped = false) => { if (checks.length < MAX_CHECKS) checks.push({ name, ok, detail, skipped }); };

  let parsed;
  try { parsed = JSON.parse(manifestBuffer.toString('utf8')); } catch { add('manifest is valid JSON', false, 'could not parse'); return finish(checks); }
  const { manifest, signature } = parsed || {};
  if (!manifest || !signature) { add('manifest has a signature block', false, 'missing manifest or signature'); return finish(checks); }

  const sig = signing.verify(manifest, signature);
  add('signature matches the manifest', sig.ok, sig.ok ? `key ${signature.keyId}` : sig.reason);
  if (!sig.ok) return finish(checks); // nothing else in an unauthenticated manifest can be trusted

  if (pdfBuffer) add('PDF matches the manifest', sha256(pdfBuffer) === manifest.pdf?.sha256, 'sha-256 of the PDF');
  else add('PDF matches the manifest', true, 'no PDF supplied', true);

  const claims = manifest.claims || [];
  add('every verified statement cites a source', claims.filter(needsSource).every((c) => c.evidence?.length > 0),
    `${claims.filter(needsSource).length} statements checked`);
  add('source Merkle root is consistent', merkleRoot((manifest.sources || []).map((s) => s.sha256)) === manifest.sourceMerkleRoot, 'root over source file hashes');

  // audit anchor
  if (manifest.audit) {
    const entry = await Audit.findOne({ seq: manifest.audit.seq }).lean();
    add('audit trail contains the export anchor', !!entry && entry.hash === manifest.audit.hash, `entry #${manifest.audit.seq}`);
    const chain = await verifyChain();
    add('audit trail is intact', chain.valid, chain.valid ? `${chain.checked} entries` : `broken at entry #${chain.brokenAtSeq}`);
  }

  // sources, as they are stored now
  const project = await Project.findById(manifest.project).select('userId').lean();
  const mayRead = project && project.userId === String(userId);
  for (const src of manifest.sources || []) {
    const doc = await Document.findById(src.documentId).lean();
    if (!mayRead || !doc || doc.classification > clearance) { add(`source "${src.filename}" unchanged`, true, 'not authorized to check this source', true); continue; }
    const key = storage.keyFromUrl(doc.fileUrl);
    const actual = key && (await storage.exists(key)) ? await storage.sha256(key) : null;
    add(`source "${src.filename}" unchanged`, actual === src.sha256 && doc.sha256 === src.sha256, actual === src.sha256 ? 'file hash matches the manifest' : actual ? 'FILE HAS CHANGED since export' : 'file is missing');
  }

  // cited passages, as they are stored now
  const byId = new Map((await EvidenceUnit.find({ _id: { $in: (manifest.citations || []).map((c) => c.unitId) } }).select('text textSha256 classification').lean()).map((u) => [String(u._id), u]));
  for (const cit of manifest.citations || []) {
    const u = byId.get(cit.unitId);
    if (!mayRead || !u || u.classification > clearance) { add(`passage [${cit.n}] unchanged`, true, 'not authorized to check this passage', true); continue; }
    const intact = sha256(u.text) === u.textSha256 && u.textSha256 === cit.unitSha256;
    const quotes = claims.flatMap((c) => c.evidence.filter((e) => e.unitId === cit.unitId)).every((e) => quoteInText(e.quote, u.text) && sha256(e.quote) === e.quoteSha256);
    add(`passage [${cit.n}] unchanged`, intact && quotes, intact && quotes ? `${cit.filename}` : 'passage or quote no longer matches');
  }
  return finish(checks);
}

function finish(checks) {
  const failed = checks.filter((c) => !c.ok);
  return { valid: failed.length === 0, complete: !checks.some((c) => c.skipped), checks, failed: failed.map((c) => c.name) };
}

module.exports = { verifyExport };
