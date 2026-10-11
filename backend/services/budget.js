/**
 * Choose which evidence units fit a prompt budget without letting one large document crowd out the rest.
 * Units are taken one at a time, round-robin across documents, each document in reading order, until the
 * budget is spent; the chosen units are then returned grouped by document in reading order.
 * `cost(unit)` is the number of characters the unit adds to the prompt.
 */
function pickUnitsFairly(units, maxChars, cost) {
  const byDoc = new Map();
  for (const u of units) {
    const key = String(u.documentId);
    if (!byDoc.has(key)) byDoc.set(key, []);
    byDoc.get(key).push(u);
  }
  const queues = [...byDoc.values()].map((list) => list.sort((a, b) => a.ordinal - b.ordinal));
  const chosen = new Set();
  let used = 0;
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const q of queues) {
      if (!q.length) continue;
      const c = cost(q[0]);
      if (used + c > maxChars) { q.length = 0; continue; } // this document's next unit no longer fits
      used += c;
      chosen.add(q.shift());
      progressed = true;
    }
  }
  return units
    .filter((u) => chosen.has(u))
    .sort((a, b) => (String(a.documentId) < String(b.documentId) ? -1 : String(a.documentId) > String(b.documentId) ? 1 : a.ordinal - b.ordinal));
}

module.exports = { pickUnitsFairly };
