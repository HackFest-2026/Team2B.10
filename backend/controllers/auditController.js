const Audit = require('../models/Audit');
const { verifyChain } = require('../services/audit');

// GET /api/audit — the caller's own audit entries plus the integrity result for the whole chain.
async function auditLog(req, res) {
  try {
    const entries = await Audit.find({ actorId: req.userId }).sort({ seq: -1 }).limit(200).lean();
    res.json({ integrity: await verifyChain(), entries });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read audit log' });
  }
}

module.exports = { auditLog };
