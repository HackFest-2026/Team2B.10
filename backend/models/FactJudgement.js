const mongoose = require('mongoose');

// Cached verdict of the narrow model check on a pair of free-text values, so a pair is judged once.
const FactJudgementSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  pairKey: { type: String, required: true },
  contradict: { type: Boolean, required: true },
  reason: { type: String, default: '' },
  judgedAt: { type: Date, default: Date.now },
});
FactJudgementSchema.index({ projectId: 1, pairKey: 1 }, { unique: true });

module.exports = mongoose.model('FactJudgement', FactJudgementSchema);
