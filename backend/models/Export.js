const mongoose = require('mongoose');

// An immutable, signed rendering of a draft at one version and one reader clearance.
const ExportSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  draftId: { type: mongoose.Schema.Types.ObjectId, ref: 'Draft', required: true, index: true },
  draftVersion: { type: Number, required: true },
  exportedBy: { type: String, required: true },
  clearance: { type: Number, required: true },
  classification: { type: Number, required: true }, // highest level among the statements actually included
  pdfKey: { type: String, required: true },
  manifestKey: { type: String, required: true },
  pdfSha256: { type: String, required: true },
  manifestSha256: { type: String, required: true },
  pages: { type: Number },
  summary: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Export', ExportSchema);
