const mongoose = require('mongoose');

// Append-only, hash-chained audit trail: each row commits to the previous row's hash,
// so editing or deleting any earlier row breaks verification of every later one.
const AuditSchema = new mongoose.Schema({
  seq: { type: Number, required: true, unique: true },
  ts: { type: Date, required: true },
  actorId: { type: String, default: 'system' },
  action: { type: String, required: true },
  object: { type: String, default: '' },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  prevHash: { type: String, required: true },
  hash: { type: String, required: true },
}, { minimize: false }); // keep empty meta {} so the stored row hashes identically

module.exports = mongoose.model('Audit', AuditSchema);
