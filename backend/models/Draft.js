const mongoose = require('mongoose');

const EvidenceSchema = new mongoose.Schema({
  unitId: { type: mongoose.Schema.Types.ObjectId, ref: 'EvidenceUnit', required: true },
  documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true },
  quote: { type: String, required: true },       // verbatim excerpt of the unit
  unitSha256: { type: String, required: true },  // the unit's text hash when the claim was verified
}, { _id: false });

// One statement of the document. `status` decides whether it may appear as a verified finding.
const ClaimSchema = new mongoose.Schema({
  id: { type: String, required: true },
  text: { type: String, required: true },
  status: { type: String, enum: ['supported', 'conflicted', 'unsupported', 'human'], required: true },
  authored: { type: String, enum: ['model', 'human', 'conflict-report'], default: 'model' },
  edited: { type: Boolean, default: false },
  classification: { type: Number, min: 0, max: 3, required: true },
  evidence: { type: [EvidenceSchema], default: [] },
  entailment: { type: Number }, // best NLI entailment probability against the cited evidence
  conflictIds: { type: [String], default: [] },
}, { _id: false });

const DraftSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  template: { type: String, required: true },
  focus: { type: String, default: '' },
  createdBy: { type: String, required: true },
  sourceDocIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  status: { type: String, enum: ['GENERATING', 'READY', 'ERROR'], default: 'GENERATING' },
  error: { type: String, default: '' },
  progress: { phase: { type: String, default: '' }, done: { type: Number, default: 0 }, total: { type: Number, default: 0 } },
  version: { type: Number, default: 1 },
  sections: [{
    _id: false,
    key: String,
    heading: String,
    claims: [ClaimSchema],
  }],
  coverage: { type: mongoose.Schema.Types.Mixed, default: undefined }, // sources in scope and unresolved gaps (consolidated report)
  rejected: [{ _id: false, section: String, text: String, reason: String, classification: Number }], // dropped before they were ever claims
  stats: { type: mongoose.Schema.Types.Mixed, default: {} },
  model: { type: mongoose.Schema.Types.Mixed, default: {} },
  revisions: [{ _id: false, version: Number, by: String, at: Date, action: String, claimId: String, beforeSha: String, afterSha: String }],
  createdAt: { type: Date, default: Date.now },
  generatedAt: { type: Date },
}, { minimize: false });

module.exports = mongoose.model('Draft', DraftSchema);
