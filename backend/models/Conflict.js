const mongoose = require('mongoose');

// Two sources stating different values for the same field. Derived deterministically from extracted facts
// (services/facts.js); `status` records the human review.
const ConflictSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  pairKey: { type: String, required: true },
  unitA: { type: mongoose.Schema.Types.ObjectId, ref: 'EvidenceUnit', required: true },
  unitB: { type: mongoose.Schema.Types.ObjectId, ref: 'EvidenceUnit', required: true },
  docA: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true },
  docB: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true },
  classification: { type: Number, required: true, min: 0, max: 3 }, // highest of the two units
  kind: { type: String },
  supportA: { type: Number, default: 1 }, // how many units state value A / value B
  supportB: { type: Number, default: 1 },
  field: { type: String },
  valueA: { type: String },
  valueB: { type: String },
  quoteA: { type: String },
  quoteB: { type: String },
  explanation: { type: String },
  status: { type: String, enum: ['open', 'confirmed', 'dismissed'], default: 'open' },
  reviewedBy: { type: String },
  reviewedAt: { type: Date },
  detectedAt: { type: Date, default: Date.now },
});

ConflictSchema.index({ projectId: 1, pairKey: 1 }, { unique: true });
ConflictSchema.index({ projectId: 1, classification: 1 });

module.exports = mongoose.model('Conflict', ConflictSchema);
