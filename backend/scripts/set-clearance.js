// Usage: node scripts/set-clearance.js <email> <0-3>
// Clearance is assigned by an administrator; users cannot raise their own.
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const { CLASSIFICATIONS } = require('../sourceTypes');

(async () => {
  const [email, level] = process.argv.slice(2);
  const n = Number(level);
  if (!email || !Number.isInteger(n) || n < 0 || n >= CLASSIFICATIONS.length) {
    console.error(`Usage: node scripts/set-clearance.js <email> <0-${CLASSIFICATIONS.length - 1}>  (${CLASSIFICATIONS.map((c, i) => `${i}=${c}`).join(', ')})`);
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/mirage');
  const user = await User.findOneAndUpdate({ email: email.toLowerCase() }, { clearance: n }, { new: true });
  if (!user) { console.error('No such user'); process.exit(1); }
  const { record } = require('../services/audit');
  await record('admin-cli', 'CLEARANCE_SET', `user:${user._id}`, { clearance: n });
  console.log(`${user.email} now has clearance ${n} (${CLASSIFICATIONS[n]})`);
  await mongoose.disconnect();
})();
