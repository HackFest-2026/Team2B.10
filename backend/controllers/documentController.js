const Document = require('../models/Document');
const Insight = require('../models/Insight');
const EvidenceUnit = require('../models/EvidenceUnit');
const User = require('../models/User');
const { SOURCE_TYPES, CLASSIFICATIONS, MAX_CLASSIFICATION, extensionOf } = require('../sourceTypes');
const { triggerProcessing } = require('../services/worker');
const storage = require('../services/storage');
const { record } = require('../services/audit');
const Conflict = require('../models/Conflict');

// POST /api/projects/:projectId/upload
async function uploadDocument(req, res) {
  try {
    const { projectId } = req.params;
    const { fileUrl, filename } = req.body;
    const sourceType = req.body.sourceType || 'report';
    const classification = req.body.classification === undefined ? 0 : Number(req.body.classification);

    if (!fileUrl || !filename) {
      return res.status(400).json({ error: 'fileUrl and filename are required' });
    }
    if (!SOURCE_TYPES[sourceType]) {
      return res.status(400).json({ error: `sourceType must be one of: ${Object.keys(SOURCE_TYPES).join(', ')}` });
    }
    const extension = extensionOf(filename);
    if (!SOURCE_TYPES[sourceType].includes(extension)) {
      return res.status(400).json({ error: `.${extension || '?'} files cannot be ingested as '${sourceType}' (allowed: ${SOURCE_TYPES[sourceType].join(', ')})` });
    }
    if (!Number.isInteger(classification) || classification < 0 || classification > MAX_CLASSIFICATION) {
      return res.status(400).json({ error: `classification must be an integer 0-${MAX_CLASSIFICATION}` });
    }

    // Users may only label material at or below their own clearance.
    const user = await User.findById(req.userId).select('clearance').lean();
    if (!user || classification > user.clearance) {
      await record(req.userId, 'ACCESS_DENIED', `upload:${projectId}`, { classification, clearance: user ? user.clearance : null });
      return res.status(403).json({ error: `Your clearance (${CLASSIFICATIONS[user ? user.clearance : 0]}) does not allow uploading ${CLASSIFICATIONS[classification]} material` });
    }

    // Only files previously stored through POST /api/files are accepted (no external URLs).
    const storageKey = storage.keyFromUrl(fileUrl);
    if (!storageKey || !(await storage.exists(storageKey))) {
      return res.status(400).json({ error: 'fileUrl must reference an uploaded file' });
    }
    if (storageKey.split('.').pop() !== extension) {
      return res.status(400).json({ error: 'filename extension does not match the uploaded file' });
    }
    if (await Document.exists({ $or: [{ fileUrl }, { annotatedFileUrl: fileUrl }] })) {
      return res.status(409).json({ error: 'File is already attached to a document' });
    }

    const document = await Document.create({
      projectId,
      filename,
      fileUrl,
      sha256: await storage.sha256(storageKey),
      sourceType,
      classification,
      uploadedBy: req.userId,
      status: 'PROCESSING',
    });
    await record(req.userId, 'DOCUMENT_UPLOAD', `document:${document._id}`, {
      projectId, filename, storageKey, sourceType, classification, sha256: document.sha256,
    });

    // Trigger async processing (fire and forget, handle errors gracefully)
    triggerProcessing({ documentId: document._id.toString(), projectId: projectId.toString(), storageKey, filename, sourceType })
      .then((result) => storeResult(document, result))
      .catch(async (err) => {
        console.error('Processing failed:', err.message);
        await Document.findByIdAndUpdate(document._id, { status: 'ERROR', errorMessage: err.message });
        await record('system', 'DOCUMENT_ERROR', `document:${document._id}`, { error: err.message });
      });

    res.status(201).json(document);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Persists worker output. Everything derived from a source inherits that source's classification.
async function storeResult(document, result) {
  const { _id: documentId, projectId, classification } = document;
  const units = result.units || [];
  if (units.length === 0) throw new Error('No evidence units were extracted from this source');

  // Idempotent on retry: never leave a half-written set behind.
  await Promise.all([EvidenceUnit.deleteMany({ documentId }), Insight.deleteMany({ documentId })]);

  await EvidenceUnit.insertMany(units.map((u, i) => ({
    projectId, documentId, ordinal: i + 1, classification,
    text: u.text, textSha256: u.textSha256, loc: u.loc, fields: u.fields,
    parseStatus: u.parseStatus, confidence: u.confidence ?? undefined, embedding: u.embedding,
  })));

  if (result.insights && result.insights.length > 0) {
    await Insight.insertMany(result.insights.map((i) => ({
      projectId, documentId, pageNumber: i.pageNumber, insightText: i.insightText, highlights: i.highlights,
    })));
  }

  await Document.findByIdAndUpdate(documentId, {
    status: 'DONE',
    pageCount: result.pageCount ?? undefined,
    unitCount: units.length,
    ocrConfidence: result.ocrConfidence ?? undefined,
    warnings: result.warnings || [],
    annotatedFileUrl: result.annotatedStorageKey ? storage.urlFor(result.annotatedStorageKey) : undefined,
  });
  await record('system', 'DOCUMENT_PROCESSED', `document:${documentId}`, {
    units: units.length, ocrConfidence: result.ocrConfidence ?? null, warnings: (result.warnings || []).length,
  });
}

// GET /api/projects/:projectId/documents
async function listDocuments(req, res) {
  try {
    const { projectId } = req.params;
    const documents = await Document.find({ projectId, classification: { $lte: req.clearance } }).sort({ createdAt: -1 }).lean();
    const counts = new Map((await Insight.aggregate([
      { $match: { documentId: { $in: documents.map((d) => d._id) } } },
      { $group: { _id: '$documentId', n: { $sum: 1 } } },
    ])).map((r) => [String(r._id), r.n]));
    res.json(documents.map((d) => ({ ...d, insightCount: counts.get(String(d._id)) || 0 })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/projects/:projectId/documents/:documentId/reprocess
// Reads the stored file again, so a PDF uploaded while insight generation was off (or that failed) gets its highlights
// and notes. Evidence units are rebuilt, so anything that pointed at the old ones (conflicts, report evidence) is
// recomputed: conflicts involving this document are removed and the next analysis finds them again.
async function reprocessDocument(req, res) {
  try {
    const document = req.document;
    if (document.status === 'PROCESSING') return res.status(409).json({ error: 'This document is already being processed' });
    const storageKey = storage.keyFromUrl(document.fileUrl);
    if (!storageKey || !(await storage.exists(storageKey))) return res.status(404).json({ error: 'The stored file is missing' });

    await Conflict.deleteMany({ projectId: document.projectId, $or: [{ docA: document._id }, { docB: document._id }] });
    await Document.findByIdAndUpdate(document._id, { status: 'PROCESSING', errorMessage: '' });
    await record(req.userId, 'DOCUMENT_REPROCESS', `document:${document._id}`, { filename: document.filename });

    triggerProcessing({ documentId: document._id.toString(), projectId: document.projectId.toString(), storageKey, filename: document.filename, sourceType: document.sourceType })
      .then((result) => storeResult(document, result))
      .catch(async (err) => {
        console.error('Reprocessing failed:', err.message);
        await Document.findByIdAndUpdate(document._id, { status: 'ERROR', errorMessage: err.message });
        await record('system', 'DOCUMENT_ERROR', `document:${document._id}`, { error: err.message });
      });
    res.status(202).json({ status: 'PROCESSING' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/documents/:documentId
async function getDocument(req, res) {
  try {
    // Ownership already verified by router.param('documentId')
    res.json(req.document);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/projects/:projectId/documents/:documentId/insights
async function getInsights(req, res) {
  try {
    const { projectId, documentId } = req.params;
    const insights = await Insight.find({ projectId, documentId }).sort({ pageNumber: 1 });
    res.json(insights);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/projects/:projectId/documents/:documentId/insights
async function createInsight(req, res) {
  try {
    const { projectId, documentId } = req.params;
    const { text, note, tags, pageNumber, boundingRect, type } = req.body;

    if (!text || !note || !pageNumber) {
      return res.status(400).json({ error: 'text, note, and pageNumber are required' });
    }

    const insight = await Insight.create({
      projectId,
      documentId,
      pageNumber,
      insightText: note, // mirror note into insightText for sidebar compatibility
      type:        type || 'user-created',
      text:        text  || '',
      note:        note  || '',
      tags:        tags  || [],
      boundingRect: boundingRect || { left: 0, top: 0, width: 0, height: 0 },
    });

    res.status(201).json(insight);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/projects/:projectId/documents/:documentId/units?skip=&limit=&q=&raw=true
async function listUnits(req, res) {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const skip = Math.max(Number(req.query.skip) || 0, 0);
    const query = { documentId: req.document._id };
    if (req.query.q) query.text = { $regex: String(req.query.q).slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    if (req.query.raw === 'true') query.parseStatus = 'raw';
    if (req.query.lowConfidence === 'true') query['fields.lowConfidence'] = true;

    const [units, total] = await Promise.all([
      EvidenceUnit.find(query).sort({ ordinal: 1 }).skip(skip).limit(limit).lean(),
      EvidenceUnit.countDocuments(query),
    ]);
    await record(req.userId, 'UNITS_READ', `document:${req.document._id}`, { skip, limit });
    res.json({ total, skip, limit, units });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { reprocessDocument, listUnits, uploadDocument, listDocuments, getDocument, getInsights, createInsight };
