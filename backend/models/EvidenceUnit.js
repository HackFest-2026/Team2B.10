const mongoose = require('mongoose');

// The smallest citable piece of a source (a text paragraph, OCR block, log event or chat turn).
// `loc` is the stable source location that citations resolve to.
const EvidenceUnitSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true },
  ordinal: { type: Number, required: true },
  classification: { type: Number, required: true, min: 0, max: 3, index: true },
  text: { type: String, required: true },
  textSha256: { type: String, required: true },
  loc: { type: mongoose.Schema.Types.Mixed, default: {} },
  fields: { type: mongoose.Schema.Types.Mixed, default: {} },
  parseStatus: { type: String, enum: ['ok', 'raw'], default: 'ok' },
  confidence: { type: Number }, // OCR confidence 0-100, absent for native text
  mentions: { type: [mongoose.Schema.Types.Mixed], default: undefined }, // [{text, type, via}] from /extract
  mentionsAt: { type: Date },
  facts: { type: [mongoose.Schema.Types.Mixed], default: undefined }, // [{subject, field, value, type, quote}] from /extract-facts
  factsAt: { type: Date },
  factGaps: { type: [String], default: undefined }, // times/counts/dates the unit states that no fact accounts for
  eventField: { type: String },                     // milestone a log event marks (from the prose-derived vocabulary)
  eventVocab: { type: String },                     // hash of the vocabulary the label was made against
  embedding: { type: [Number], select: false },
}, { minimize: false });

EvidenceUnitSchema.index({ documentId: 1, ordinal: 1 });

module.exports = mongoose.model('EvidenceUnit', EvidenceUnitSchema);
