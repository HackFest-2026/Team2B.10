const mongoose = require('mongoose');

const InsightSchema = new mongoose.Schema({
  projectId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Project',  required: true, index: true },
  documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true, index: true },
  pageNumber: { type: Number, required: true },

  // ── System-generated insight fields ──────────────────────────────────────
  insightText: { type: String, default: '' },
  highlights: [
    {
      text: { type: String },
      bbox: { x0: Number, y0: Number, x1: Number, y1: Number },
    },
  ],

  // ── User-created highlight fields (type === 'user-created') ───────────────
  type: { type: String, default: 'system' }, // 'system' | 'user-created'
  text: { type: String, default: '' },       // exact selected text
  note: { type: String, default: '' },       // user annotation
  tags: [{ type: String }],

  // Unscaled PDF coordinates (divide by scale before saving, multiply when rendering)
  boundingRect: {
    left:   { type: Number, default: 0 },
    top:    { type: Number, default: 0 },
    width:  { type: Number, default: 0 },
    height: { type: Number, default: 0 },
  },
}, { timestamps: true });

module.exports = mongoose.model('Insight', InsightSchema);
