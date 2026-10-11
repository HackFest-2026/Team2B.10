// Near-duplicate unit detection: exact normalized matches plus token-set Jaccard similarity, using an
// inverted index over rare tokens so it stays fast on large logs. Duplicates are linked, not deleted.
const JACCARD_THRESHOLD = 0.85;
const MIN_TOKENS = 4;        // very short units ("ok", "thanks") are not meaningful duplicates
const MAX_DOC_FREQ = 40;     // tokens in more units than this are too common to block on

const tokenize = (text) => new Set((text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}._:-]*/gu) || []));

function findDuplicates(units) {
  const items = units.map((u) => ({ u, tokens: tokenize(u.text) })).filter((i) => i.tokens.size >= MIN_TOKENS);

  const exact = new Map();
  items.forEach((it, idx) => {
    const key = [...it.tokens].sort().join(' ');
    if (!exact.has(key)) exact.set(key, []);
    exact.get(key).push(idx);
  });

  const parent = items.map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { const [ra, rb] = [find(a), find(b)]; if (ra !== rb) parent[rb] = ra; };
  for (const idxs of exact.values()) for (let i = 1; i < idxs.length; i++) { union(idxs[0], idxs[i]); }

  // near-duplicates: candidates share a rare token
  const index = new Map();
  items.forEach((it, idx) => it.tokens.forEach((t) => { if (!index.has(t)) index.set(t, []); index.get(t).push(idx); }));
  items.forEach((it, i) => {
    const counts = new Map();
    for (const t of it.tokens) {
      const posting = index.get(t);
      if (posting.length > MAX_DOC_FREQ) continue;
      for (const j of posting) if (j > i) counts.set(j, (counts.get(j) || 0) + 1);
    }
    for (const [j, shared] of counts) {
      if (find(i) === find(j) || shared < 3) continue;
      const other = items[j].tokens;
      const union_ = it.tokens.size + other.size - shared;
      if (shared / union_ >= JACCARD_THRESHOLD) { union(i, j); }
    }
  });

  const groups = new Map();
  items.forEach((it, idx) => {
    const r = find(idx);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(it.u);
  });
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => ({
      kind: new Set(g.map((u) => [...tokenize(u.text)].sort().join(' '))).size === 1 ? 'exact' : 'near',
      units: g,
      documents: new Set(g.map((u) => String(u.documentId))).size,
      classification: g.reduce((max, u) => Math.max(max, u.classification), 0),
    }))
    .sort((a, b) => b.units.length - a.units.length);
}

module.exports = { findDuplicates, tokenize, JACCARD_THRESHOLD };
