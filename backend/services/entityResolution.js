// Entity resolution over mentions. Pure functions: no database, no model calls, fully testable.
//
// Mentions are never discarded when merged: each entity keeps a link to every original mention.
// Resolution is recomputed from the mentions the caller may read, so a canonical name or alias can
// never be derived from material above their clearance.
const crypto = require('crypto');

const ORG_SUFFIXES = new Set(['inc', 'corp', 'corporation', 'ltd', 'llc', 'co', 'company', 'gmbh', 'plc']);
const TITLES = new Set(['dr', 'mr', 'mrs', 'ms', 'miss', 'prof', 'sir', 'mx']);
const FAMILY = { HOST: 'SYSTEM', SYSTEM: 'SYSTEM', PERSON: 'PERSON', ORG: 'ORG', LOCATION: 'LOCATION', IP: 'IP', ID: 'ID', EMAIL: 'EMAIL' };
const EXACT_ONLY = new Set(['IP', 'ID', 'EMAIL']);
const AUTO_RATIO = 0.9;      // surname / name similarity that merges automatically
const POSSIBLE_RATIO = 0.75; // similarity that proposes a match for a human to decide

function levenshteinRatio(a, b) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

const words = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(Boolean);

function normalize(text, family) {
  if (family === 'PERSON') return words(text).filter((w) => !TITLES.has(w)).join(' ');
  if (EXACT_ONLY.has(family) || family === 'SYSTEM') return text.trim().toLowerCase();
  const w = words(text);
  const core = family === 'ORG' && w.length > 1 ? w.filter((x) => !ORG_SUFFIXES.has(x)) : w; // "Acme Corp" = "Acme"
  return core.sort().join(' '); // ORG / LOCATION: word order does not matter
}

const keyOf = (family, norm) => `${family}|${norm}`;

function parsePerson(norm) {
  const parts = norm.split(' ').filter(Boolean);
  return { surname: parts[parts.length - 1] || '', given: parts.slice(0, -1) };
}

// 'full' > 'compatible' > null. Initials are compatible with names that start with them.
function givenCompat(a, b) {
  if (!a.length || !b.length) return 'unknown';
  const [x, y] = [a[0], b[0]];
  if (x === y) return 'match';
  if (x.length === 1 || y.length === 1) return x[0] === y[0] ? 'match' : 'conflict';
  const r = levenshteinRatio(x, y);
  return r >= AUTO_RATIO ? 'match' : r >= POSSIBLE_RATIO ? 'close' : 'conflict';
}

class UnionFind {
  constructor() { this.p = new Map(); }
  find(x) { if (!this.p.has(x)) this.p.set(x, x); let r = x; while (this.p.get(r) !== r) r = this.p.get(r); this.p.set(x, r); return r; }
  union(a, b) { const [ra, rb] = [this.find(a), this.find(b)]; if (ra !== rb) this.p.set(rb, ra); }
}

/**
 * @param mentions  [{text, type, unitId, docId, classification}]
 * @param decisions [{keyA, keyB, decision: 'merge'|'split'}] human rulings
 * @returns {entities, possible}
 */
function resolveEntities(mentions, decisions = []) {
  // 1. surface forms: one per (family, normalized text)
  const forms = new Map();
  for (const m of mentions) {
    const family = FAMILY[m.type];
    if (!family || !m.text) continue;
    const norm = normalize(m.text, family);
    if (!norm) continue;
    const key = keyOf(family, norm);
    if (!forms.has(key)) forms.set(key, { key, family, norm, surfaces: new Map(), mentions: [] });
    const f = forms.get(key);
    f.surfaces.set(m.text.trim(), (f.surfaces.get(m.text.trim()) || 0) + 1);
    f.mentions.push(m);
  }

  const split = new Set();
  const merges = [];
  for (const d of decisions) {
    const pair = [d.keyA, d.keyB].sort().join('\u0000');
    if (d.decision === 'split') split.add(pair);
    else if (d.decision === 'merge') merges.push([d.keyA, d.keyB]);
  }
  const blocked = (a, b) => split.has([a, b].sort().join('\u0000'));

  const uf = new UnionFind();
  const possible = new Map(); // pairKey -> {keyA, keyB, reason, score}
  const propose = (a, b, reason, score) => {
    if (blocked(a.key, b.key)) return;
    const k = [a.key, b.key].sort().join('\u0000');
    if (!possible.has(k) || possible.get(k).score < score) possible.set(k, { keyA: a.key, keyB: b.key, reason, score: Math.round(score * 100) / 100 });
  };

  const byFamily = {};
  for (const f of forms.values()) { uf.find(f.key); (byFamily[f.family] ||= []).push(f); }

  for (const [family, list] of Object.entries(byFamily)) {
    if (EXACT_ONLY.has(family)) continue;
    if (family === 'PERSON') resolvePeople(list, uf, propose, blocked);
    else {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          // Names with digits (atlas-db-02 vs atlas-db-03) differ in exactly the part that matters: never fuzzy-match them.
          if (/\d/.test(list[i].norm) || /\d/.test(list[j].norm)) continue;
          const r = levenshteinRatio(list[i].norm, list[j].norm);
          if (r >= AUTO_RATIO && !blocked(list[i].key, list[j].key)) uf.union(list[i].key, list[j].key);
          else if (r >= POSSIBLE_RATIO) propose(list[i], list[j], `similar names (${Math.round(r * 100)}%)`, r);
        }
      }
    }
  }
  for (const [a, b] of merges) if (forms.has(a) && forms.has(b)) uf.union(a, b);

  // 2. assemble entities
  const groups = new Map();
  for (const f of forms.values()) {
    const root = uf.find(f.key);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(f);
  }
  const entities = [];
  const entityOfKey = new Map();
  for (const members of groups.values()) {
    const surfaces = new Map();
    const ms = [];
    for (const f of members) {
      for (const [s, c] of f.surfaces) surfaces.set(s, (surfaces.get(s) || 0) + c);
      ms.push(...f.mentions);
    }
    const aliases = [...surfaces.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).map(([s]) => s);
    const keys = members.map((f) => f.key).sort();
    const entity = {
      id: crypto.createHash('sha1').update(keys[0]).digest('hex').slice(0, 12),
      type: members[0].family,
      canonical: canonicalName(surfaces, members[0].family),
      aliases,
      keys,
      mentionCount: ms.length,
      unitIds: [...new Set(ms.map((m) => String(m.unitId)))],
      docIds: [...new Set(ms.map((m) => String(m.docId)))],
      classification: ms.reduce((max, m) => Math.max(max, m.classification || 0), 0),
      mentions: ms.slice(0, 200).map((m) => ({ unitId: String(m.unitId), docId: String(m.docId), text: m.text })),
      inferred: members.some((f) => f.inferred),
    };
    entities.push(entity);
    keys.forEach((k) => entityOfKey.set(k, entity));
  }
  entities.sort((a, b) => b.mentionCount - a.mentionCount || a.canonical.localeCompare(b.canonical));

  const possibleOut = [...possible.values()]
    .map((p) => ({ ...p, a: entityOfKey.get(p.keyA), b: entityOfKey.get(p.keyB) }))
    .filter((p) => p.a && p.b && p.a !== p.b)
    .map((p) => ({
      keyA: p.keyA, keyB: p.keyB, reason: p.reason, score: p.score,
      a: { id: p.a.id, canonical: p.a.canonical }, b: { id: p.b.id, canonical: p.b.canonical },
      classification: Math.max(p.a.classification, p.b.classification),
    }))
    .sort((x, y) => y.score - x.score);

  return { entities, possible: possibleOut };
}

// Prefer the fullest, most frequent spelling ("Priya Raman" over "Raman").
function canonicalName(surfaces, family) {
  const ranked = [...surfaces.entries()].sort((a, b) => {
    if (family === 'PERSON') {
      const wa = words(a[0]).filter((w) => !TITLES.has(w)); const wb = words(b[0]).filter((w) => !TITLES.has(w));
      const fullA = wa.length > 1 && wa[0].length > 1; const fullB = wb.length > 1 && wb[0].length > 1;
      if (fullA !== fullB) return fullA ? -1 : 1;
    }
    return b[1] - a[1] || b[0].length - a[0].length;
  });
  return ranked[0][0];
}

function resolvePeople(list, uf, propose, blocked) {
  const parsed = list.map((f) => ({ f, ...parsePerson(f.norm) }));
  const full = parsed.filter((p) => p.given.length > 0);
  const single = parsed.filter((p) => p.given.length === 0);

  // full names (or initial + surname): same surname and compatible given names merge
  for (let i = 0; i < full.length; i++) {
    for (let j = i + 1; j < full.length; j++) {
      const [a, b] = [full[i], full[j]];
      // "Aisha K." has an initial for a surname: compatible with any surname starting with that letter
      const sr = Math.min(a.surname.length, b.surname.length) === 1
        ? (a.surname[0] === b.surname[0] ? AUTO_RATIO : 0)
        : levenshteinRatio(a.surname, b.surname);
      if (sr < POSSIBLE_RATIO) continue;
      const g = givenCompat(a.given, b.given);
      if (g === 'conflict' || blocked(a.f.key, b.f.key)) continue;
      // identical full given names plus a one-letter surname slip ("Priya Raman"/"Priya Ramen") is safe to merge
      const sameFullGiven = a.given[0] === b.given[0] && a.given[0].length > 1;
      if (g === 'match' && (sr >= AUTO_RATIO || (sameFullGiven && sr >= 0.8))) uf.union(a.f.key, b.f.key);
      else propose(a.f, b.f, `similar name (${Math.round(sr * 100)}% surname)`, sr * (g === 'match' ? 1 : 0.85));
    }
  }
  // surname-only mentions attach only when exactly one person has that surname; otherwise ask a human
  for (const s of single) {
    const matches = full.filter((p) => levenshteinRatio(p.surname, s.surname) >= AUTO_RATIO && !blocked(p.f.key, s.f.key));
    const people = new Set(matches.map((p) => uf.find(p.f.key)));
    if (people.size === 1) { uf.union(s.f.key, matches[0].f.key); s.f.inferred = true; }
    else if (people.size > 1) matches.forEach((p) => propose(s.f, p.f, `surname shared by ${people.size} people`, 0.6));
  }
}

/**
 * Pairwise precision/recall of a predicted clustering against ground-truth labels.
 * @param items [{label, cluster}] one per mention; items without a label are ignored
 */
function pairwiseScores(items) {
  const labelled = items.filter((i) => i.label != null);
  let tp = 0, fp = 0, fn = 0;
  for (let i = 0; i < labelled.length; i++) {
    for (let j = i + 1; j < labelled.length; j++) {
      const same = labelled[i].label === labelled[j].label;
      const joined = labelled[i].cluster === labelled[j].cluster;
      if (same && joined) tp++; else if (!same && joined) fp++; else if (same && !joined) fn++;
    }
  }
  return { precision: tp + fp ? tp / (tp + fp) : 1, recall: tp + fn ? tp / (tp + fn) : 1, tp, fp, fn };
}

/** text -> entity id, for values that are themselves names ("Priya Raman", "atlas-db-02"). */
function entityLookup(entities) {
  const byKey = new Map();
  for (const e of entities) for (const k of e.keys) byKey.set(k, e.id);
  return (text) => {
    for (const family of ['PERSON', 'SYSTEM', 'ORG', 'LOCATION']) {
      const norm = normalize(String(text), family);
      const id = norm && byKey.get(keyOf(family, norm));
      if (id) return id;
    }
    return null;
  };
}

module.exports = { entityLookup, resolveEntities, pairwiseScores, levenshteinRatio, normalize, keyOf, FAMILY };
