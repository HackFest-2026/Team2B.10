const crypto = require('crypto');
const Audit = require('../models/Audit');

const GENESIS = '0'.repeat(64);

function digest({ seq, ts, actorId, action, object, meta, prevHash }) {
  const payload = JSON.stringify([seq, new Date(ts).toISOString(), actorId, action, object, meta || {}, prevHash]);
  return crypto.createHash('sha256').update(payload).digest('hex');
}

// Appends are serialised in-process so seq/prevHash stay consistent.
let tail = Promise.resolve();

function record(actorId, action, object = '', meta = {}) {
  const job = tail.then(async () => {
    const last = await Audit.findOne().sort({ seq: -1 }).lean();
    const entry = {
      seq: last ? last.seq + 1 : 1,
      ts: new Date(),
      actorId: actorId ? String(actorId) : 'system',
      action,
      object: String(object),
      meta,
      prevHash: last ? last.hash : GENESIS,
    };
    entry.hash = digest(entry);
    await Audit.create(entry);
    return entry;
  });
  // Never let a failed audit write poison the queue; the caller still sees the error.
  tail = job.catch((err) => console.error('Audit write failed:', err.message));
  return job;
}

async function verifyChain() {
  let prev = GENESIS;
  let expectedSeq = 1;
  let count = 0;
  for await (const row of Audit.find().sort({ seq: 1 }).lean().cursor()) {
    if (row.seq !== expectedSeq || row.prevHash !== prev || row.hash !== digest(row)) {
      return { valid: false, brokenAtSeq: row.seq, checked: count };
    }
    prev = row.hash;
    expectedSeq += 1;
    count += 1;
  }
  return { valid: true, checked: count, head: prev };
}

module.exports = { record, verifyChain };
