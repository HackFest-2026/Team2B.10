// Fact comparison. The model only *reads* facts out of units (worker/facts.py); deciding whether two
// facts disagree is done here, deterministically, so every conflict is reproducible and explainable.
const crypto = require('crypto');

const APPROX = /\b(about|around|roughly|approximately|approx\.?|circa|nearly|almost|some|estimated)\b|~/i;
const TIME_TOLERANCE_MIN = 1;          // "02:31" and "02:31:07" are the same minute
const APPROX_TIME_TOLERANCE_MIN = 5;   // "about 02:30" does not contradict 02:31
const APPROX_RELATIVE_TOLERANCE = 0.1; // "about 9,800" does not contradict 9,900
const FIELD_JACCARD = 0.6;
const FIELD_COSINE = 0.85;          // embedding similarity that merges field names sharing at least one word
const FIELD_COSINE_NO_OVERLAP = 0.93; // ...and the (much higher) bar when they share no word at all
const STOP = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'at', 'for', 'to', 'and', 'or', 'by', 'with', 'is', 'was']);

// ── value normalisation ────────────────────────────────────────────────────

const UNIT_MINUTES = { s: 1 / 60, sec: 1 / 60, secs: 1 / 60, second: 1 / 60, seconds: 1 / 60, m: 1, min: 1, mins: 1, minute: 1, minutes: 1, h: 60, hr: 60, hrs: 60, hour: 60, hours: 60, d: 1440, day: 1440, days: 1440 };

function parseDuration(text) {
  let total = 0, found = false;
  for (const m of text.toLowerCase().matchAll(/(\d+(?:\.\d+)?)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|h|m|s|d)\b/g)) {
    total += parseFloat(m[1]) * UNIT_MINUTES[m[2]];
    found = true;
  }
  return found ? total : null;
}

function parseClock(text) {
  const m = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (m[4]) h = (h % 12) + (m[4].toLowerCase() === 'pm' ? 12 : 0);
  if (h > 23 || min > 59) return null;
  return h * 60 + min + (m[3] ? Number(m[3]) / 60 : 0);
}

function parseDate(text) {
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(text);
  const t = iso ? Date.UTC(+iso[1], +iso[2] - 1, +iso[3]) : Date.parse(`${text} UTC`);
  return Number.isNaN(t) ? null : Math.floor(t / 86400000);
}

function parseNumber(text) {
  const m = /(\d[\d,]*(?:\.\d+)?)\s*([kKmM])?\b/.exec(text);
  if (!m) return null;
  const base = parseFloat(m[1].replace(/,/g, ''));
  return base * ({ k: 1e3, m: 1e6 }[(m[2] || '').toLowerCase()] || 1);
}

/** @returns {kind, num|text, approx} or null when the value cannot be understood */
function normalizeValue(value, type, quote = '') {
  const approx = APPROX.test(quote) || APPROX.test(value);
  const v = String(value);
  if (type === 'time') { const n = parseClock(v); return n == null ? null : { kind: 'time', num: n, approx }; }
  if (type === 'datetime') {
    const clock = parseClock(v), day = /\d{4}-\d{2}-\d{2}/.test(v) ? parseDate(v) : null;
    if (clock == null) return null;
    return day == null ? { kind: 'time', num: clock, approx } : { kind: 'datetime', num: day * 1440 + clock, approx };
  }
  if (type === 'date') { const n = parseDate(v); return n == null ? null : { kind: 'date', num: n, approx }; }
  if (type === 'duration') { const n = parseDuration(v); return n == null ? null : { kind: 'duration', num: n, approx }; }
  if (type === 'number') { const n = parseNumber(v); return n == null ? null : { kind: 'number', num: n, approx }; }
  const text = v.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return text ? { kind: 'text', text, approx: false } : null;
}

/** Do two normalized values of the same kind disagree beyond tolerance? Returns the gap description or null. */
const CLOCK = new Set(['time', 'datetime']);
const timeOfDay = (n) => ((n.num % 1440) + 1440) % 1440;
const familyOf = (norm) => (CLOCK.has(norm.kind) ? 'clock' : norm.kind);

function disagreement(a, b) {
  if (familyOf(a) !== familyOf(b)) return null;
  const approx = a.approx || b.approx;
  switch (a.kind) {
    case 'time': case 'datetime': {
      // A report's "02:14" and a log's "2024-03-14 02:31:07" are compared as clock times; two full datetimes exactly.
      const bothFull = a.kind === 'datetime' && b.kind === 'datetime';
      const gap = bothFull ? Math.abs(a.num - b.num) : Math.abs(timeOfDay(a) - timeOfDay(b));
      const tol = approx ? APPROX_TIME_TOLERANCE_MIN : TIME_TOLERANCE_MIN;
      return gap > tol ? `differ by ${formatMinutes(gap)}` : null;
    }
    case 'date': return a.num !== b.num ? `differ by ${Math.abs(a.num - b.num)} day(s)` : null;
    case 'duration': {
      const gap = Math.abs(a.num - b.num);
      const tol = approx ? Math.max(a.num, b.num) * APPROX_RELATIVE_TOLERANCE : TIME_TOLERANCE_MIN;
      return gap > tol ? `differ by ${formatMinutes(gap)}` : null;
    }
    case 'number': {
      const gap = Math.abs(a.num - b.num);
      const tol = approx ? Math.max(a.num, b.num) * APPROX_RELATIVE_TOLERANCE : 0;
      return gap > tol ? `differ by ${Number(gap.toFixed(2)).toLocaleString('en-US')}` : null;
    }
    default:
      // Free-text values ("failed disk controller" vs "disk controller errors") are wordings, not values, so they
      // are handled by compareText(). Here only coded values that carry a digit (Severity 1 / 2, P1 / P2) are compared.
      if (!/\d/.test(a.text) || !/\d/.test(b.text)) return null;
      return a.text === b.text ? null : 'are different';
  }
}

function formatMinutes(m) {
  if (m < 1) return `${Math.round(m * 60)} seconds`;
  if (m < 120) return `${Number(m.toFixed(1))} minutes`;
  return `${Number((m / 60).toFixed(1))} hours`;
}

// Coded text values ("Severity 1" vs "Severity 2") are comparable only for level-like fields. Identifiers
// (reference codes, ticket numbers, hashes) are *meant* to differ between documents and are never conflicts.
const LEVEL_FIELD = /severity|priority|level|tier|grade|rank/i;
const IDENTIFIER_FIELD = /code|\bid\b|identifier|reference|ticket|number|hash|token|key|serial|version|\bref\b/i;
const comparableAsCode = (field) => LEVEL_FIELD.test(field) && !IDENTIFIER_FIELD.test(field);

// ── field and subject matching ─────────────────────────────────────────────

// Words that flip the meaning of a field: start ≠ end ≠ duration, even though embeddings call them similar.
const ROLE_WORDS = { START: /^(start|starts|started|begin|begins|began|onset|first|opened)$/, END: /^(end|ends|ended|finish|finished|stop|stopped|resolved|resolution|restored|recovery|recovered|last|closed)$/, DURATION: /^(duration|length|lasted|lasting|elapsed)$/ };
const fieldTokens = (name) => name.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((t) => t && !STOP.has(t));
const roles = (tokens) => new Set(Object.entries(ROLE_WORDS).filter(([, re]) => tokens.some((t) => re.test(t))).map(([r]) => r));

function jaccard(a, b) {
  const [A, B] = [new Set(a), new Set(b)];
  const inter = [...A].filter((x) => B.has(x)).length;
  return A.size + B.size ? inter / (A.size + B.size - inter) : 0;
}

function sameRoles(a, b) {
  const [ra, rb] = [roles(a), roles(b)];
  return ra.size === rb.size && [...ra].every((r) => rb.has(r));
}

/** Group field names that mean the same thing. embeddings: optional Map(name -> vector). */
function clusterFields(names, embeddings, cosine) {
  const parent = new Map(names.map((n) => [n, n]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const toks = new Map(names.map((n) => [n, fieldTokens(n)]));
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const [a, b] = [names[i], names[j]];
      if (!sameRoles(toks.get(a), toks.get(b))) continue;
      const overlap = jaccard(toks.get(a), toks.get(b));
      const sim = embeddings && embeddings.has(a) && embeddings.has(b) ? cosine(embeddings.get(a), embeddings.get(b)) : 0;
      const close = overlap >= FIELD_JACCARD || sim >= (overlap > 0 ? FIELD_COSINE : FIELD_COSINE_NO_OVERLAP);
      if (close) parent.set(find(a), find(b));
    }
  }
  return new Map(names.map((n) => [n, find(n)]));
}

// Two facts about the same field are comparable unless they are about different *named* things:
// "atlas-db-02 outage" and "atlas-db-03 outage" must not be compared. Subjects the model words loosely
// ("outage window", "sessions") carry no identifier and so never block a comparison.
const identifiers = (subject) => new Set(subject.toLowerCase().split(/\s+/).filter((t) => /\d/.test(t) && /[a-z]/.test(t)));

// Words that name no particular thing. In long documents (papers, manuals) a fact is only comparable with another
// when both are about the same specific subject, so these are ignored when matching subjects.
const GENERIC = new Set(['the', 'a', 'an', 'of', 'and', 'for', 'in', 'on', 'to', 'our', 'we', 'it', 'its', 'this', 'that', 'paper', 'papers', 'model', 'models', 'method', 'methods', 'approach', 'system', 'systems', 'score', 'scores', 'result', 'results', 'performance', 'task', 'tasks', 'value', 'values', 'number', 'accuracy', 'metric', 'overall', 'total', 'average', 'work', 'study', 'dataset', 'data', 'arxiv', 'preprint', 'document', 'report', 'article', 'publication', 'date', 'version', 'training', 'learning', 'evaluation', 'time', 'duration', 'size', 'step', 'steps', 'epoch', 'epochs', 'test', 'dev', 'setting', 'baseline']);
// A field that names no specific quantity ("statement time", "duration", "date") matches every other such field, so
// unrelated times and counts from different events would be reported as disagreeing.
const VAGUE_FIELD_WORDS = new Set(['statement', 'stated', 'event', 'local', 'reported', 'recorded', 'unspecified', 'unknown', 'general', 'status']);
const isVagueField = (field = '') => ![...contentTokens(field)].some((t) => !VAGUE_FIELD_WORDS.has(t));
const contentTokens = (subject = '') => new Set(subject.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2 && !GENERIC.has(t)));

/**
 * Facts from long documents are compared only when both subjects name exactly the same specific things
 * ("bert large" with "bert large", never "bert" with "bert base": a variant is a different thing).
 */
function strictSubjectsMatch(a, b) {
  const [ta, tb] = [contentTokens(a.fact.subject), contentTokens(b.fact.subject)];
  if (!ta.size || ta.size !== tb.size) return false;
  return [...ta].every((t) => tb.has(t));
}

const PLAIN_NUMBER = /^[\s~<>=≈+-]*\d[\d,]*(?:\.\d+)?\s*%?\s*$/;
const STRICT_MIN_RELATIVE_GAP = 0.02;

/**
 * Extra bar for facts from long documents, whose tables hold many variants of the same quantity: the field names must
 * be identical, numbers plain (no "3.3e18 / 2.6e10"), and the gap more than rounding. Dates (each paper's own
 * publication date) never conflict between long documents.
 */
function strictPairOk(a, b) {
  if (a.fact.field !== b.fact.field) return false;
  if (a.norm.kind === 'date' || b.norm.kind === 'date') return false;
  if (a.norm.kind === 'number' && b.norm.kind === 'number') {
    if (!PLAIN_NUMBER.test(String(a.fact.value)) || !PLAIN_NUMBER.test(String(b.fact.value))) return false;
    return Math.abs(a.norm.num - b.norm.num) / Math.max(Math.abs(a.norm.num), Math.abs(b.norm.num), 1e-9) >= STRICT_MIN_RELATIVE_GAP;
  }
  return true;
}

function subjectsCompatible(a, b, strictDocs) {
  if (strictDocs && (strictDocs.has(String(a.unit.documentId)) || strictDocs.has(String(b.unit.documentId)))) return strictSubjectsMatch(a, b);
  const [ia, ib] = [identifiers(a.fact.subject || ''), identifiers(b.fact.subject || '')];
  if (!ia.size || !ib.size) return true;
  return [...ia].some((id) => ib.has(id));
}

// ── conflict building ──────────────────────────────────────────────────────

const KIND_OF = { time: 'temporal', datetime: 'temporal', date: 'temporal', duration: 'value', number: 'value', text: 'status' };

/**
 * @param entries [{unit: {_id, documentId, textSha256, classification, mentions}, fact: {subject, field, value, type, quote}}]
 * @returns conflicts: one per pair of disagreeing value-groups, with the groups' sizes as support
 */
function buildConflicts(entries, { embeddings, cosine, strictDocs } = {}) {
  const items = [];
  for (const e of entries) {
    const norm = normalizeValue(e.fact.value, e.fact.type, e.fact.quote);
    if (!norm) continue;
    if (isVagueField(e.fact.field)) continue;
    if (norm.kind === 'text' && !comparableAsCode(e.fact.field)) continue; // identifiers and free text: not compared here
    items.push({ ...e, norm });
  }
  items.sort((x, y) => String(x.unit._id).localeCompare(String(y.unit._id)));

  const cluster = clusterFields([...new Set(items.map((i) => i.fact.field))], embeddings, cosine);
  const groups = new Map();
  for (const it of items) {
    const key = `${cluster.get(it.fact.field)}|${familyOf(it.norm)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }

  const conflicts = [];
  for (const [key, members] of groups) {
    // partition into value-groups of mutually agreeing facts (first link wins; tolerance is not transitive)
    const valueGroups = [];
    for (const m of members) {
      const home = valueGroups.find((g) => !disagreement(g[0].norm, m.norm));
      if (home) home.push(m); else valueGroups.push([m]);
    }
    for (let i = 0; i < valueGroups.length; i++) {
      for (let j = i + 1; j < valueGroups.length; j++) {
        let best = null;
        for (const a of valueGroups[i]) {
          for (const b of valueGroups[j]) {
            if (String(a.unit.documentId) === String(b.unit.documentId) || !subjectsCompatible(a, b, strictDocs)) continue;
            if (strictDocs && (strictDocs.has(String(a.unit.documentId)) || strictDocs.has(String(b.unit.documentId))) && !strictPairOk(a, b)) continue;
            best = best || { a, b };
          }
        }
        if (!best) continue;
        const { a, b } = best;
        const gap = disagreement(a.norm, b.norm);
        const label = [...new Set(members.map((m) => m.fact.field))].sort((x, y) => x.length - y.length)[0];
        const [first, second] = [a, b].sort((x, y) => String(x.unit._id).localeCompare(String(y.unit._id)));
        conflicts.push({
          pairKey: crypto.createHash('sha256').update(`${key}|${first.unit.textSha256}|${first.fact.value}|${second.unit.textSha256}|${second.fact.value}`).digest('hex'),
          field: label,
          kind: KIND_OF[a.norm.kind],
          a, b,
          supportA: new Set(valueGroups[i].map((x) => String(x.unit._id))).size,
          supportB: new Set(valueGroups[j].map((x) => String(x.unit._id))).size,
          explanation: `Sources disagree on ${label}: "${a.fact.value}" vs "${b.fact.value}" (${gap}).`,
        });
      }
    }
  }
  return conflicts;
}


const isEndField = (field) => roles(fieldTokens(field)).has('END');

// ── free-text and named values ─────────────────────────────────────────────

/**
 * Non-numeric values ("cause: failed disk controller", "person responsible: Priya Raman").
 *  - both values name known entities (via entity resolution): compared deterministically, different entities conflict
 *  - otherwise: returned as `candidates` for a narrow, cached model check (services/factJudge.js)
 * @param entityOf  text -> entity id | null
 */
function compareText(entries, { embeddings, cosine, entityOf = () => null, strictDocs } = {}) {
  const items = [];
  for (const e of entries) {
    const norm = normalizeValue(e.fact.value, e.fact.type, e.fact.quote);
    if (norm && norm.kind === 'text' && !/\d/.test(norm.text)) items.push({ ...e, norm });
  }
  items.sort((x, y) => String(x.unit._id).localeCompare(String(y.unit._id)));

  const cluster = clusterFields([...new Set(items.map((i) => i.fact.field))], embeddings, cosine);
  const groups = new Map();
  for (const it of items) {
    const key = `${cluster.get(it.fact.field)}|text`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }

  const conflicts = [];
  const candidates = [];
  for (const [key, members] of groups) {
    // "R. Tanaka" and "Rahul Tanaka" are one person: group named values by the entity they resolve to, not by spelling.
    const identity = (m) => entityOf(m.fact.value) || `text:${m.norm.text}`;
    const valueGroups = [];
    for (const m of members) {
      const home = valueGroups.find((g) => identity(g[0]) === identity(m));
      if (home) home.push(m); else valueGroups.push([m]);
    }
    const label = [...new Set(members.map((m) => m.fact.field))].sort((x, y) => x.length - y.length)[0];
    for (let i = 0; i < valueGroups.length; i++) {
      for (let j = i + 1; j < valueGroups.length; j++) {
        let best = null;
        for (const a of valueGroups[i]) {
          for (const b of valueGroups[j]) {
            if (String(a.unit.documentId) === String(b.unit.documentId) || !subjectsCompatible(a, b, strictDocs)) continue;
            best = best || { a, b };
          }
        }
        if (!best) continue;
        const { a, b } = best;
        const [first, second] = [a, b].sort((x, y) => String(x.unit._id).localeCompare(String(y.unit._id)));
        const base = {
          pairKey: crypto.createHash('sha256').update(`${key}|${first.unit.textSha256}|${first.fact.value}|${second.unit.textSha256}|${second.fact.value}`).digest('hex'),
          field: label, a, b,
          supportA: new Set(valueGroups[i].map((x) => String(x.unit._id))).size,
          supportB: new Set(valueGroups[j].map((x) => String(x.unit._id))).size,
        };
        const [ea, eb] = [entityOf(a.fact.value), entityOf(b.fact.value)];
        if (ea && eb) {
          if (ea !== eb) conflicts.push({ ...base, kind: 'attribution', explanation: `Sources name different entities for ${label}: "${a.fact.value}" vs "${b.fact.value}".` });
        } else {
          candidates.push(base);
        }
      }
    }
  }
  return { conflicts, candidates };
}

module.exports = { strictSubjectsMatch, normalizeValue, disagreement, buildConflicts, compareText, clusterFields, subjectsCompatible, isEndField };
