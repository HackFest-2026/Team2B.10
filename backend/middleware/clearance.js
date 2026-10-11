const User = require('../models/User');

// Loads the caller's current clearance from the database on every request, so a change
// (e.g. a downgrade) takes effect immediately instead of when the token expires.
module.exports = async function loadClearance(req, res, next) {
  try {
    const user = await User.findById(req.userId).select('clearance').lean();
    if (!user) return res.status(401).json({ error: 'Account no longer exists' });
    req.clearance = user.clearance;
    next();
  } catch (err) {
    next(err);
  }
};
