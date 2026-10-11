const mongoose = require('mongoose');

const ProjectSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  userId: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },

  // ── Project summary fields ──────────────────────────────────────
  summary: { type: String, default: '' },
  summaryStatus: {
    type: String,
    enum: ['NONE', 'GENERATING', 'DONE', 'ERROR'],
    default: 'NONE',
  },
  summaryError: { type: String, default: '' },
  summaryGeneratedAt: { type: Date },
  // Highest classification among the units the summary was built from. Readers below it get nothing.
  summaryClassification: { type: Number, default: 0 },
  // Entity/conflict analysis run state (contains no source content).
  analysis: {
    status: { type: String, enum: ['NONE', 'RUNNING', 'DONE', 'ERROR'], default: 'NONE' },
    phase: { type: String, default: '' },
    done: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    startedAt: { type: Date },
    finishedAt: { type: Date },
    error: { type: String, default: '' },
    stats: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  summarySources: { type: [mongoose.Schema.Types.Mixed], default: [] },
});

module.exports = mongoose.model('Project', ProjectSchema);
