const multer = require('multer');
const storage = require('../services/storage');
const Document = require('../models/Document');
const Project = require('../models/Project');
const { record } = require('../services/audit');
const { MAX_UPLOAD_BYTES } = require('../config');
const { ALLOWED_EXTENSIONS, MIME, extensionOf } = require('../sourceTypes');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

// POST /api/files — stores bytes and returns a reference; the file only becomes
// readable once a Document owned by the caller points at it.
const uploadFile = [
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      if (!ALLOWED_EXTENSIONS.has(extensionOf(req.file.originalname))) {
        return res.status(415).json({ error: `Unsupported file type. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}` });
      }
      const { key, sha256, size } = await storage.put(req.file.buffer, req.file.originalname);
      await record(req.userId, 'FILE_STORED', key, { filename: req.file.originalname, sha256, size });
      res.status(201).json({ fileUrl: storage.urlFor(key), sha256, size });
    } catch (err) {
      console.error('File store error:', err.message);
      res.status(500).json({ error: 'Failed to store file' });
    }
  },
];

// GET /api/files/:key — only for files referenced by a document in a project the caller owns.
async function downloadFile(req, res) {
  try {
    const { key } = req.params;
    if (!storage.isValidKey(key)) return res.status(404).json({ error: 'File not found' });

    const url = storage.urlFor(key);
    const doc = await Document.findOne({ $or: [{ fileUrl: url }, { annotatedFileUrl: url }] }).lean();
    const project = doc && (await Project.findById(doc.projectId).lean());
    const aboveClearance = doc && doc.classification > req.clearance;
    if (!project || project.userId !== req.userId || aboveClearance || !(await storage.exists(key))) {
      await record(req.userId, 'ACCESS_DENIED', `file:${key}`, aboveClearance ? { reason: 'clearance' } : {});
      return res.status(404).json({ error: 'File not found' });
    }

    await record(req.userId, 'FILE_READ', key, { documentId: String(doc._id) });
    res.setHeader('Content-Type', MIME[key.split('.').pop()] || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(storage.pathFor(key));
  } catch (err) {
    res.status(500).json({ error: 'Failed to read file' });
  }
}

module.exports = { uploadFile, downloadFile };
