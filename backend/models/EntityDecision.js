const mongoose = require('mongoose');

// A human ruling on a proposed entity match. Keys are "<family>|<normalized name>".
const EntityDecisionSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  keyA: { type: String, required: true },
  keyB: { type: String, required: true },
  decision: { type: String, enum: ['merge', 'split'], required: true },
  decidedBy: { type: String },
  decidedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('EntityDecision', EntityDecisionSchema);
