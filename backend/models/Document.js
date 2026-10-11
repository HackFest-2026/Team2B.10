const mongoose = require('mongoose');

const DocumentSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  filename: { type: String, required: true },
  fileUrl: { type: String, required: true },
  annotatedFileUrl: { type: String },
  sha256: { type: String },
  sourceType: { type: String, enum: ['scan', 'report', 'chatlog', 'syslog'], required: true },
  classification: { type: Number, min: 0, max: 3, required: true, default: 0 },
  uploadedBy: { type: String },
  unitCount: { type: Number, default: 0 },
  ocrConfidence: { type: Number },
  warnings: { type: [String], default: [] },
  status: {
    type: String,
    enum: ['UPLOADED', 'PROCESSING', 'DONE', 'ERROR'],
    default: 'UPLOADED',
  },
  pageCount: { type: Number },
  errorMessage: { type: String },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Document', DocumentSchema);
