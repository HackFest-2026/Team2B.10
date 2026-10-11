// Phase 3 acceptance: duplicate entities link to their mentions, seeded contradictions surface with both
// supporting locations, and nothing derived from higher-clearance material is visible below it.
process.env.JWT_SECRET ||= 'test-secret-test-secret';
process.env.OLLAMA_URL = 'http://127.0.0.1:5089';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./helpers');
const { resolveEntities, pairwiseScores } = require('../services/entityResolution');
const { findDuplicates } = require('../services/duplicates');

const M = (text, type, i, extra = {}) => ({ text, type, unitId: `u${i}`, docId: 'd1', classification: 0, ...extra });

test('entity resolution: aliases merge, different people stay apart, accuracy on a labelled fixture', () => {
  // label = ground-truth identity; null = deliberately ambiguous, excluded from scoring
  const fixture = [
    ['Priya Raman', 'PERSON', 'priya'], ['P. Raman', 'PERSON', 'priya'], ['Dr. P. Raman', 'PERSON', 'priya'], ['priya raman', 'PERSON', 'priya'],
    ['Priya Ramen', 'PERSON', 'priya'], // typo
    ['Rahul Raman', 'PERSON', 'rahul'], ['R. Raman', 'PERSON', 'rahul'],
    ['Marco Silva', 'PERSON', 'marco'], ['M. Silva', 'PERSON', 'marco'], ['Silva', 'PERSON', 'marco'],
    ['Aisha Khan', 'PERSON', 'aisha'], ['Aisha K.', 'PERSON', 'aisha'],
    ['Raman', 'PERSON', null],
    ['atlas-db-02', 'HOST', 'db02'], ['Atlas-DB-02', 'SYSTEM', 'db02'], ['ATLAS-DB-02', 'HOST', 'db02'],
    ['atlas-db-03', 'HOST', 'db03'],
    ['10.0.4.17', 'IP', 'ip1'], ['10.0.4.17', 'IP', 'ip1'], ['10.0.4.71', 'IP', 'ip2'],
    ['Acme Corp', 'ORG', 'acme'], ['Acme Corporation', 'ORG', 'acme'], ['Globex Industries', 'ORG', 'globex'],
  ];
  const mentions = fixture.map(([text, type], i) => M(text, type, i));
  const { entities } = resolveEntities(mentions);
  const clusterOf = new Map();
  entities.forEach((e) => e.mentions.forEach((m) => clusterOf.set(m.unitId, e.id)));

  const { precision, recall } = pairwiseScores(fixture.map(([, , label], i) => ({ label, cluster: clusterOf.get(`u${i}`) })));
  assert.ok(precision >= 0.95, `precision ${precision}`);
  assert.ok(recall >= 0.9, `recall ${recall}`);

  // every original mention is still linked: nothing is discarded by merging
  assert.equal(entities.reduce((n, e) => n + e.mentionCount, 0), mentions.length);
  const priya = entities.find((e) => e.aliases.includes('P. Raman'));
  assert.equal(priya.canonical, 'Priya Raman');
  assert.ok(!priya.aliases.includes('Rahul Raman'));
});

test('ambiguous surname-only mentions are proposed, not guessed; human decisions are honoured', () => {
  const mentions = [M('Priya Raman', 'PERSON', 1), M('Rahul Raman', 'PERSON', 2), M('Raman', 'PERSON', 3), M('Globex', 'ORG', 5), M('Globex Corp', 'ORG', 6)];
  const first = resolveEntities(mentions);
  const lone = first.entities.find((e) => e.aliases.includes('Raman'));
  assert.equal(lone.mentionCount, 1, 'not attached to either Raman');
  assert.ok(first.possible.some((p) => /surname shared by 2/.test(p.reason)));

  // a human merges "raman" into priya, and splits Globex / Globex Corp
  const priyaKey = 'PERSON|priya raman';
  const merged = resolveEntities(mentions, [{ keyA: 'PERSON|raman', keyB: priyaKey, decision: 'merge' }]);
  assert.ok(merged.entities.find((e) => e.aliases.includes('Raman')).aliases.includes('Priya Raman'));
  // a human forces apart two names the algorithm joined automatically
  const joined = resolveEntities([M('Marco Silva', 'PERSON', 1), M('M. Silva', 'PERSON', 2)]);
  assert.equal(joined.entities.length, 1);
  const apart = resolveEntities([M('Marco Silva', 'PERSON', 1), M('M. Silva', 'PERSON', 2)], [{ keyA: 'PERSON|marco silva', keyB: 'PERSON|m silva', decision: 'split' }]);
  assert.equal(apart.entities.length, 2);
});

test('duplicate detection finds exact and near-duplicates across documents without merging distinct text', () => {
  const u = (id, text, doc) => ({ _id: id, documentId: doc, classification: 0, text });
  const groups = findDuplicates([
    u(1, 'The outage began at 02:14 UTC and lasted 47 minutes on atlas-db-02', 'A'),
    u(2, 'the outage began at 02:14 UTC and lasted 47 minutes on atlas-db-02!', 'B'),
    u(3, 'The outage began at 02:14 UTC and lasted 47 minutes on atlas-db-02 today', 'C'),
    u(4, 'Payments service returned errors for the duration of the incident', 'A'),
    u(5, 'The outage began at 02:31 UTC and lasted 12 minutes on atlas-db-03', 'B'),
    u(6, 'ok', 'A'), u(7, 'ok', 'B'),
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].units.map((x) => x._id).sort(), [1, 2, 3]);
  assert.equal(groups[0].documents, 3);
  assert.equal(groups[0].kind, 'near');
});

// ─────────────────────────── fact comparison (pure) ───────────────────────────
const { normalizeValue, disagreement, buildConflicts } = require('../services/facts');

test('values normalise across spellings and compare with sensible tolerance', () => {
  const n = (v, t, q = '') => normalizeValue(v, t, q);
  assert.equal(n('02:14 UTC', 'time').num, 134);
  assert.equal(n('2:14 PM', 'time').num, 14 * 60 + 14);
  assert.equal(n('12,400', 'number').num, 12400);
  assert.equal(n('1h 20m', 'duration').num, 80);
  assert.equal(n('47 minutes', 'duration').num, 47);
  assert.equal(n('not a time', 'time'), null);

  assert.equal(disagreement(n('02:31', 'time', 'since about 02:31'), n('02:31:07', 'time')), null, 'same minute');
  assert.match(disagreement(n('02:14', 'time'), n('02:31', 'time')), /17 minutes/);
  assert.equal(disagreement(n('02:30', 'time', 'about 02:30'), n('02:31', 'time')), null, 'approximate times tolerate small gaps');
  assert.match(disagreement(n('12,400', 'number'), n('9,800', 'number')), /2,600/);
  assert.equal(disagreement(n('9,800', 'number', 'about 9,800'), n('9,900', 'number')), null, 'approximate counts tolerate 10%');
  assert.equal(disagreement(n('47 minutes', 'duration'), n('0.78 hours', 'duration')) === null, true, 'unit-insensitive durations agree');
  assert.equal(disagreement(n('Severity 1', 'text'), n('severity 1', 'text')), null);
  assert.equal(disagreement(n('02:14', 'time'), n('47', 'number')), null, 'different kinds are never compared');
});

const E = (id, doc, fact, extra = {}) => ({ unit: { _id: id, documentId: doc, textSha256: `sha${id}`, classification: 0, mentions: [], ...extra }, fact: { subject: 'atlas-db-02 outage', type: 'time', quote: fact.value, ...fact } });

test('buildConflicts: differing values conflict, start/end/duration never mix, same-source and agreeing facts do not conflict', () => {
  const found = buildConflicts([
    E(1, 'report', { field: 'outage start time', value: '02:14' }),
    E(2, 'chat', { field: 'outage start', value: '02:31' }),                    // worded differently, same field
    E(3, 'chat', { field: 'outage end time', value: '03:18' }),                 // end is not start
    E(4, 'report', { field: 'outage duration', value: '47 minutes', type: 'duration' }),
    E(5, 'logs', { field: 'outage duration', value: '47 min', type: 'duration' }), // agrees with 4
    E(6, 'report', { field: 'outage start time', value: '02:50' }),             // same doc as 1: ignored against it, but conflicts with chat
    E(7, 'chat', { field: 'sessions affected', value: '12,400', type: 'number', subject: 'sessions' }),
    E(8, 'report', { field: 'sessions affected', value: '9,800', type: 'number', subject: 'sessions' }),
    E(9, 'logs', { field: 'outage start time', value: '04:00', subject: 'atlas-db-03 outage' }), // a different named system
    E(10, 'logs', { field: 'outage start time', value: '05:00', subject: 'outage window' }), // loosely worded subject: still comparable
    E(11, 'logs', { field: 'severity', value: 'Severity 1', type: 'text', subject: 'incident' }),
    E(12, 'chat', { field: 'severity', value: 'Severity 2', type: 'text', subject: 'incident' }),
    E(15, 'logs', { field: 'reference code', value: 'CANARY-L1-6bf46c69', type: 'text', subject: 'incident' }), // identifiers differ by design
    E(16, 'chat', { field: 'reference code', value: 'CANARY-L3-ab1031d0', type: 'text', subject: 'incident' }),
    E(13, 'logs', { field: 'cause', value: 'failed disk controller', type: 'text', subject: 'incident' }),
    E(14, 'chat', { field: 'cause', value: 'disk controller errors in dmesg', type: 'text', subject: 'incident' }),
  ]);
  const byField = (f) => found.filter((c) => c.field === f || c.field.startsWith(f));
  const start = byField('outage start');
  const pairs = start.map((c) => [c.a.fact.value, c.b.fact.value].sort().join('/'));
  assert.ok(pairs.includes('02:14/02:31') && pairs.includes('02:31/02:50'), pairs.join(' '));
  assert.ok(!pairs.some((p) => p.includes('04:00')), 'a different named system is never compared');
  assert.ok(pairs.some((p) => p.includes('05:00')), 'a loosely worded subject does not block comparison');
  assert.equal(found.filter((c) => c.field === 'severity').length, 1, 'coded values with digits are compared');
  assert.equal(found.filter((c) => c.field === 'cause').length, 0, 'free-text wordings are not conflicts');
  assert.equal(found.filter((c) => c.field === 'reference code').length, 0, 'identifiers are meant to differ and are never conflicts');
  assert.equal(found.filter((c) => /end|duration/.test(c.field)).length, 0);
  assert.equal(found.filter((c) => c.field === 'sessions affected').length, 1);
  assert.ok(found.every((c) => String(c.a.unit.documentId) !== String(c.b.unit.documentId)));
  assert.ok(found.every((c) => /Sources disagree on/.test(c.explanation)));
  assert.equal(new Set(found.map((c) => c.pairKey)).size, found.length);
});

test('buildConflicts: support counts group agreeing sources and ids are stable', () => {
  const facts = [
    E(1, 'a', { field: 'sessions affected', value: '12,400', type: 'number' }),
    E(2, 'b', { field: 'sessions affected', value: '12,400', type: 'number' }),
    E(3, 'c', { field: 'sessions affected', value: '9,800', type: 'number' }),
  ];
  const [c] = buildConflicts(facts);
  assert.equal(buildConflicts(facts).length, 1);
  assert.deepEqual([c.supportA, c.supportB].sort(), [1, 2]);
  assert.equal(buildConflicts([...facts].reverse())[0].pairKey, c.pairKey, 'input order does not change the key');
});

// ─────────────── logs, named values and free text (pure) ───────────────
const { compareText } = require('../services/facts');
const { deriveLogFacts, isNotable } = require('../services/logFacts');
const { entityLookup } = require('../services/entityResolution');

test('a prose time and a log timestamp are compared as clock times', () => {
  const log = (id, ts, field, host = 'atlas-db-02') => ({ _id: id, documentId: 'syslog', eventField: field, loc: { ts }, fields: { host }, text: `event ${id}`, textSha256: `l${id}`, classification: 0, mentions: [] });
  const logFacts = deriveLogFacts([
    log(1, '2024-03-14T02:31:07+00:00', 'outage start time'), log(2, '2024-03-14T02:31:40+00:00', 'outage start time'),  // earliest wins
    log(3, '2024-03-14T02:40:00+00:00', 'outage end time'), log(4, '2024-03-14T02:49:44+00:00', 'outage end time'),    // latest wins
    log(5, '2024-03-14T02:45:00+00:00', 'outage start time', 'atlas-db-03'),                                          // another host, separate fact
  ]);
  assert.deepEqual(logFacts.map((e) => [e.fact.field, e.fact.subject, e.fact.value]).sort(), [
    ['outage end time', 'atlas-db-02', '2024-03-14 02:49:44 UTC'],
    ['outage start time', 'atlas-db-02', '2024-03-14 02:31:07 UTC'],
    ['outage start time', 'atlas-db-03', '2024-03-14 02:45:00 UTC'],
  ]);
  const prose = (id, value, field) => E(id, 'report', { field, value, subject: 'atlas-db-02 outage' });
  const found = buildConflicts([
    prose(10, '02:14 UTC', 'outage start time'), prose(11, '02:31', 'outage start time'), prose(12, '03:18 UTC', 'outage end time'), ...logFacts,
  ]);
  const gaps = found.map((c) => `${c.field}: ${[c.a.fact.value, c.b.fact.value].sort().join(' vs ')}`).sort();
  assert.deepEqual(gaps, [
    'outage end time: 03:18 UTC vs 2024-03-14 02:49:44 UTC',
    'outage start time: 02:14 UTC vs 2024-03-14 02:31:07 UTC',
  ], '02:31 (same minute as the log) agrees; atlas-db-03 is a different named system');
  // legacy syslog stamps have no year: only the clock time is used, never a guessed date
  const legacy = deriveLogFacts([{ _id: 9, documentId: 'syslog', eventField: 'outage end time', loc: { ts: 'Mar 14 02:49:44' }, fields: { host: 'atlas-db-03' }, text: 'ready', textSha256: 'l9', classification: 0, mentions: [] }]);
  assert.deepEqual([legacy[0].fact.value, legacy[0].fact.type], ['02:49:44', 'time']);
  assert.equal(buildConflicts([E(20, 'report', { field: 'outage end time', value: '02:49 UTC' }), ...legacy]).length, 0, 'same clock time agrees; no 2001 dates');
  assert.ok(isNotable({ fields: { level: 'ERROR' }, text: 'x' }) && isNotable({ fields: {}, text: 'database system is ready to accept connections' }));
  assert.ok(!isNotable({ fields: { level: 'INFO' }, text: 'cron job executed' }));
});

test('field names only cluster on strong evidence: embeddings alone cannot merge unrelated fields', () => {
  const { clusterFields } = require('../services/facts');
  const cos = (a, b) => (a === b ? 1 : 0.9);          // everything looks "fairly similar" to everything else
  const emb = new Map(['cause', 'person responsible', 'root cause'].map((n) => [n, n]));
  const c = clusterFields(['cause', 'person responsible', 'root cause'], emb, cos);
  assert.notEqual(c.get('cause'), c.get('person responsible'), 'no shared word + 0.9 similarity is not enough');
  assert.equal(c.get('cause'), c.get('root cause'), 'a shared word + 0.9 similarity is');
  assert.notEqual(clusterFields(['outage start', 'outage end'], new Map([['outage start', 1], ['outage end', 1]]), () => 1).get('outage start'), clusterFields(['outage start', 'outage end'], new Map([['outage start', 1], ['outage end', 1]]), () => 1).get('outage end'), 'start and end never merge');
});

test('named values are compared through entity resolution; unknown free text becomes a model candidate', () => {
  const mentions = [M('Priya Raman', 'PERSON', 1), M('P. Raman', 'PERSON', 2), M('Marco Silva', 'PERSON', 3)];
  const entityOf = entityLookup(resolveEntities(mentions).entities);
  assert.equal(entityOf('Dr. P. Raman'), entityOf('Priya Raman'), 'aliases resolve to one entity');
  assert.notEqual(entityOf('Marco Silva'), entityOf('Priya Raman'));
  assert.equal(entityOf('someone nobody has mentioned'), null);

  const who = (id, doc, value) => E(id, doc, { field: 'person responsible', value, type: 'text', subject: 'incident' });
  const out = compareText([who(1, 'a', 'Priya Raman'), who(2, 'b', 'P. Raman'), who(3, 'c', 'Marco Silva')], { entityOf });
  assert.equal(out.conflicts.length, 1, 'Marco vs Priya, once: "Priya Raman" and "P. Raman" are one person, not two disagreeing values');
  assert.ok(out.conflicts.every((c) => c.kind === 'attribution' && [c.a.fact.value, c.b.fact.value].includes('Marco Silva')));
  assert.deepEqual([out.conflicts[0].supportA, out.conflicts[0].supportB].sort(), [1, 2], 'both spellings count as support for the same person');
  assert.equal(out.candidates.length, 0);

  const cause = (id, doc, value) => E(id, doc, { field: 'cause', value, type: 'text', subject: 'incident' });
  const free = compareText([cause(1, 'a', 'failed disk controller'), cause(2, 'b', 'bad firmware update'), cause(3, 'b', 'bad firmware update')], { entityOf });
  assert.equal(free.conflicts.length, 0);
  assert.equal(free.candidates.length, 1, 'one candidate per pair of distinct values, with support counted');
  assert.deepEqual([free.candidates[0].supportA, free.candidates[0].supportB].sort(), [1, 2]);
  assert.equal(compareText([cause(1, 'a', 'failed disk controller'), cause(2, 'a', 'bad firmware update')]).candidates.length, 0, 'same-source statements are not compared');
  assert.equal(compareText([E(1, 'a', { field: 'x', value: 'Severity 1', type: 'text' })]).candidates.length, 0, 'coded values are left to the numeric path');
});

test('the text check must say "contradict" in both orders and defaults to compatible', async () => {
  const { judgeText } = require('../services/factJudge');
  const side = (quote) => ({ value: quote, quote });
  const original = t.llm.respond;
  try {
    let calls = 0;
    t.llm.respond = () => (++calls === 1 ? JSON.stringify({ relation: 'contradict', reason: 'x' }) : JSON.stringify({ relation: 'compatible', reason: 'y' }));
    assert.equal((await judgeText({ field: 'cause', subject: 's', a: side('a'), b: side('b') })).contradict, false, 'order-dependent verdicts are rejected');
    assert.equal(calls, 2);
    t.llm.respond = () => 'garbage';
    assert.equal((await judgeText({ field: 'cause', subject: 's', a: side('a'), b: side('b') })).contradict, false);
    t.llm.respond = () => JSON.stringify({ relation: 'contradict', reason: 'cannot both be true' });
    assert.deepEqual(await judgeText({ field: 'cause', subject: 's', a: side('a'), b: side('b') }), { contradict: true, reason: 'cannot both be true' });
  } finally { t.llm.respond = original; }
});

// ───────────────────────────── integration ─────────────────────────────
let t;
const FACTS = {
  'The outage began at 02:14 UTC on atlas-db-02 according to Priya Raman.': [{ subject: 'atlas-db-02 outage', field: 'outage start time', value: '02:14 UTC', type: 'time', quote: 'outage began at 02:14 UTC' }],
  'Roughly 12,400 sessions were affected.': [{ subject: 'sessions', field: 'sessions affected', value: '12,400', type: 'number', quote: 'Roughly 12,400 sessions' }],
  'Marco Silva: Around 9,800 sessions were affected, counted at the gateway.': [{ subject: 'sessions', field: 'sessions affected', value: '9,800', type: 'number', quote: 'Around 9,800 sessions' }],
  'Marco Silva: The outage window on atlas-db-02 is 02:31 to 03:18 UTC.': [
    { subject: 'atlas-db-02 outage', field: 'outage start', value: '02:31', type: 'time', quote: 'is 02:31 to' },
    { subject: 'atlas-db-02 outage', field: 'outage end time', value: '03:18 UTC', type: 'time', quote: '02:31 to 03:18 UTC' }],
  'Secret addendum: P. Raman confirmed the outage began at 02:40 UTC on atlas-db-02 and contacted Zebulon Quux.': [{ subject: 'atlas-db-02 outage', field: 'outage start time', value: '02:40 UTC', type: 'time', quote: 'outage began at 02:40 UTC' }],
};
const TEXTS = {
  'report-l0.txt': ['The outage began at 02:14 UTC on atlas-db-02 according to Priya Raman.', 'Roughly 12,400 sessions were affected.'],
  'chat-l0.txt': ['Marco Silva: Around 9,800 sessions were affected, counted at the gateway.', 'Marco Silva: The outage window on atlas-db-02 is 02:31 to 03:18 UTC.'],
  'secret-l2.txt': ['Secret addendum: P. Raman confirmed the outage began at 02:40 UTC on atlas-db-02 and contacted Zebulon Quux.'],
  'dup-l0.txt': ['Roughly 12,400 sessions were affected.'],
};
const PEOPLE = ['Priya Raman', 'P. Raman', 'Marco Silva', 'Zebulon Quux'];

// A second seeded incident exercising logs, named values, free text and coverage gaps.
const logLoc = (line, ts) => ({ line, ts, eventId: `L${line}` });
const SCENARIO = {
  'prose2-l0.txt': [
    ['Timeline: outage began at 02:14 UTC on atlas-db-02, per the report.', [{ subject: 'atlas-db-02 outage', field: 'outage start time', value: '02:14 UTC', type: 'time', quote: 'outage began at 02:14 UTC' }]],
    ['Person responsible for the incident: Priya Raman.', [{ subject: 'incident', field: 'person responsible', value: 'Priya Raman', type: 'text', quote: 'responsible for the incident: Priya Raman' }]],
    ['Root cause was a failed disk controller.', [{ subject: 'incident', field: 'cause', value: 'failed disk controller', type: 'text', quote: 'failed disk controller' }]],
    ['Costs were 4,200 dollars over 30 minutes of work.', [], ['4,200 dollars', '30 minutes']],
  ],
  'chat2-l0.txt': [
    ['Marco Silva: I took ownership of this incident.', [{ subject: 'incident', field: 'person responsible', value: 'Marco Silva', type: 'text', quote: 'Marco Silva: I took ownership' }]],
    ['Marco Silva: Cause looks like a bad firmware update.', [{ subject: 'incident', field: 'cause', value: 'bad firmware update', type: 'text', quote: 'bad firmware update' }]],
    ['Marco Silva: dmesg shows disk controller errors.', [{ subject: 'incident', field: 'cause', value: 'disk controller errors', type: 'text', quote: 'disk controller errors' }]],
    ['Marco Silva: The outage ended at 03:18 UTC.', [{ subject: 'outage', field: 'outage end time', value: '03:18 UTC', type: 'time', quote: 'ended at 03:18 UTC' }]],
  ],
  'sys-l0.log': [
    ['2024-03-14T02:31:07Z atlas-db-02 kernel disk controller reset failed', [], [], { host: 'atlas-db-02', level: 'ERROR' }, logLoc(1, '2024-03-14T02:31:07+00:00')],
    ['2024-03-14T02:31:40Z atlas-db-02 cron job executed', [], [], { host: 'atlas-db-02', level: 'INFO' }, logLoc(2, '2024-03-14T02:31:40+00:00')],
    ['2024-03-14T02:49:44Z atlas-db-03 postgres database system is ready to accept connections', [], [], { host: 'atlas-db-03' }, logLoc(3, '2024-03-14T02:49:44+00:00')],
  ],
};
const scenarioFacts = new Map();
const scenarioGaps = new Map();
const scenarioUnits = {};
for (const [file, rows] of Object.entries(SCENARIO)) {
  scenarioUnits[file] = rows.map(([text, facts, gaps, fields, loc], i) => {
    scenarioFacts.set(text, facts); scenarioGaps.set(text, gaps || []);
    return { text, textSha256: require('crypto').createHash('sha256').update(text).digest('hex'), loc: loc || { line: i + 1 }, fields: fields || {}, parseStatus: 'ok', embedding: [0.1, 0.2] };
  });
}
const LABELS = [[/disk controller reset failed/, 'outage start time'], [/ready to accept connections/, 'outage end time']];
const workerCalls = { facts: 0 };

before(async () => {
  t = await boot({
    port: 5091, workerPort: 5090, llmPort: 5089,
    workerHandler: (p, url) => {
      if (url === '/embed') return { json: { embedding: [0.1, 0.2] } };
      // identical names share a vector, different names are orthogonal (like unrelated field names in a real model)
      if (url === '/embed-many') return { json: { embeddings: p.texts.map((n) => { const v = new Array(64).fill(0); v[[...n].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 64, 7)] = 1; return v; }) } };
      if (url === '/extract-facts') {
        workerCalls.facts += p.units.length;
        return { json: { vocabulary: [], results: p.units.map((u) => ({ id: u.id, facts: FACTS[u.text] || scenarioFacts.get(u.text) || [], gaps: scenarioGaps.get(u.text) || [] })) } };
      }
      if (url === '/label-events') {
        workerCalls.labels = (workerCalls.labels || 0) + p.events.length;
        return { json: { results: p.events.map((e) => ({ id: e.id, milestone: (LABELS.find(([re]) => re.test(e.text)) || [])[1] || null })) } };
      }
      if (url === '/extract') {
        return { json: { results: p.units.map((u) => ({
          id: u.id,
          mentions: [
            ...(u.text.match(/atlas-db-\d+/g) || []).map((h) => ({ text: h, type: 'HOST', via: 'pattern' })),
            ...PEOPLE.filter((n) => u.text.includes(n)).map((n) => ({ text: n, type: 'PERSON', via: 'llm' })),
          ],
        })) } };
      }
      return { json: { pageCount: null, insights: [], annotatedStorageKey: null, ocrConfidence: null, warnings: [],
        units: scenarioUnits[p.filename] || (TEXTS[p.filename] || []).map((text, i) => ({ text, textSha256: require('crypto').createHash('sha256').update(text).digest('hex'), loc: { line: i + 1 }, fields: {}, parseStatus: 'ok', embedding: [0.1, 0.2] })) } };
    },
  });
});
after(() => t.close());

const attach = async (token, projectId, filename, classification, sourceType = 'report') => {
  const { data: { fileUrl } } = await t.store(token, filename, 'x');
  const r = await t.req('POST', `/projects/${projectId}/upload`, { token, body: { fileUrl, filename, sourceType, classification } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  await t.waitFor(async () => (await t.req('GET', `/documents/${r.data._id}`, { token })).data.status === 'DONE');
  return r.data;
};
const analyze = async (token, projectId) => {
  const r = await t.req('POST', `/projects/${projectId}/analysis`, { token, body: {} });
  assert.equal(r.status, 202, JSON.stringify(r.data));
  return t.waitFor(async () => {
    const s = (await t.req('GET', `/projects/${projectId}/analysis`, { token })).data;
    return s.status === 'RUNNING' ? null : s;
  }, 15000);
};
const setClearance = (email, level) => t.mongoose.connection.collection('users').updateOne({ email }, { $set: { clearance: level } });
const pairName = (c) => [c.a.filename, c.b.filename].sort().join('×');

test('analysis finds the seeded contradictions with both locations, resolves aliases, and is incremental', async () => {
  const email = 'analyst@test.local';
  const token = await t.signup(email, 3);
  const project = (await t.req('POST', '/projects', { token, body: { name: 'INC' } })).data;
  await attach(token, project._id, 'report-l0.txt', 0);
  await attach(token, project._id, 'chat-l0.txt', 0);
  await attach(token, project._id, 'secret-l2.txt', 2);
  await attach(token, project._id, 'dup-l0.txt', 0);

  const status = await analyze(token, project._id);
  assert.equal(status.status, 'DONE', status.error);
  assert.equal(status.stats.unitsWithNewFacts, 6);

  // start time: report 02:14 vs chat 02:31 vs secret 02:40 (3 pairs); sessions: 12,400 (report+dup) vs 9,800 (chat)
  const conflicts = (await t.req('GET', `/projects/${project._id}/conflicts`, { token })).data;
  assert.equal(conflicts.length, 4, conflicts.map((c) => `${c.field} ${pairName(c)}`).join('; '));
  const start = conflicts.filter((c) => /start/.test(c.field));
  assert.equal(start.length, 3);
  assert.ok(!conflicts.some((c) => /end/.test(c.field)), 'the end time (03:18) is not compared with start times');
  const reportVsChat = start.find((c) => pairName(c) === 'chat-l0.txt×report-l0.txt');
  assert.ok(reportVsChat, 'seeded contradiction surfaced');
  assert.deepEqual([reportVsChat.a.value, reportVsChat.b.value].sort(), ['02:14 UTC', '02:31']);
  for (const side of [reportVsChat.a, reportVsChat.b]) assert.ok(side.loc.line && side.unitId && side.quote && side.filename);
  assert.match(reportVsChat.explanation, /17 minutes/);
  const sessions = conflicts.find((c) => c.field === 'sessions affected');
  assert.deepEqual([sessions.supportA, sessions.supportB].sort(), [1, 2], 'the duplicated 12,400 counts as two supporting units');
  assert.ok(conflicts.every((c) => c.status === 'open'));

  // entities: aliases merge and keep every mention link
  const { entities } = (await t.req('GET', `/projects/${project._id}/entities`, { token })).data;
  const priya = entities.find((e) => e.aliases.includes('P. Raman'));
  assert.ok(priya.aliases.includes('Priya Raman'));
  assert.equal(priya.mentionCount, 2);
  assert.equal(priya.classification, 2);
  assert.ok(entities.find((e) => e.canonical === 'atlas-db-02').mentionCount >= 3);

  // duplicates across documents are linked
  const dups = (await t.req('GET', `/projects/${project._id}/duplicates`, { token })).data;
  assert.equal(dups.length, 1);
  assert.equal(dups[0].documents, 2);

  // human review survives a re-run, and nothing is re-read by the model
  await t.req('PATCH', `/projects/${project._id}/conflicts/${sessions.id}`, { token, body: { status: 'dismissed' } });
  const before = workerCalls.facts;
  const again = await analyze(token, project._id);
  assert.equal(again.stats.unitsWithNewFacts, 0);
  assert.equal(workerCalls.facts, before, 'facts are extracted once per unit');
  const after = (await t.req('GET', `/projects/${project._id}/conflicts`, { token })).data;
  assert.equal(after.length, 4);
  assert.equal(after.find((c) => c.field === 'sessions affected').status, 'dismissed');
  assert.equal((await t.req('GET', `/projects/${project._id}/conflicts?status=open`, { token })).data.length, 3);
  assert.equal((await t.req('PATCH', `/projects/${project._id}/conflicts/${sessions.id}`, { token, body: { status: 'bogus' } })).status, 400);

  // graph shows documents, entities and conflict nodes
  const graph = (await t.req('GET', `/projects/${project._id}/entity-graph`, { token })).data;
  assert.ok(graph.nodes.some((n) => n.type === 'entity') && graph.nodes.some((n) => n.type === 'conflict'));
  assert.ok(graph.links.some((l) => l.type === 'contradicts'));

  // entity decisions: unknown keys rejected, a split is applied
  assert.equal((await t.req('POST', `/projects/${project._id}/entities/decisions`, { token, body: { keyA: 'PERSON|nobody', keyB: 'PERSON|priya raman', decision: 'merge' } })).status, 404);
  const split = await t.req('POST', `/projects/${project._id}/entities/decisions`, { token, body: { keyA: 'PERSON|p raman', keyB: 'PERSON|priya raman', decision: 'split' } });
  assert.equal(split.status, 200);

  // ── downgrade: nothing derived from the Secret document stays visible ──
  await setClearance(email, 1);
  const visible = (await t.req('GET', `/projects/${project._id}/conflicts`, { token })).data;
  assert.equal(visible.length, 2, 'only conflicts between non-secret sources remain');
  assert.ok(visible.every((c) => c.classification <= 1 && ![c.a.filename, c.b.filename].includes('secret-l2.txt')));
  const low = (await t.req('GET', `/projects/${project._id}/entities`, { token })).data;
  assert.ok(!JSON.stringify(low).includes('Zebulon Quux'), 'names that only appear in Secret material are gone');
  assert.ok(low.entities.every((e) => e.classification <= 1));
  const lowPriya = low.entities.find((e) => e.aliases.includes('Priya Raman'));
  assert.ok(!lowPriya.aliases.includes('P. Raman'), 'alias seen only in Secret material is not revealed');
  assert.equal(lowPriya.mentionCount, 1);
  const graphLow = JSON.stringify((await t.req('GET', `/projects/${project._id}/entity-graph`, { token })).data);
  assert.ok(!graphLow.includes('secret-l2') && !graphLow.includes('Zebulon') && !graphLow.includes('02:40'));
  assert.deepEqual((await t.req('GET', `/projects/${project._id}/analysis`, { token })).data.stats, {}, 'stats from a higher-clearance run are hidden');
  const secretConflict = conflicts.find((c) => [c.a.filename, c.b.filename].includes('secret-l2.txt'));
  assert.equal((await t.req('PATCH', `/projects/${project._id}/conflicts/${secretConflict.id}`, { token, body: { status: 'confirmed' } })).status, 404);
  assert.equal((await t.req('POST', `/projects/${project._id}/entities/decisions`, { token, body: { keyA: 'PERSON|zebulon quux', keyB: 'PERSON|priya raman', decision: 'merge' } })).status, 404, 'cannot probe hidden entity names');

  // a re-run at the lower clearance must not delete or alter what only higher clearance can see
  const rerun = await analyze(token, project._id);
  assert.equal(rerun.status, 'DONE');
  await setClearance(email, 3);
  assert.equal((await t.req('GET', `/projects/${project._id}/conflicts`, { token })).data.length, 4, 'secret conflicts survive a low-clearance run');
});

test('logs, named values and free text are compared; coverage gaps are reported; checks are cached', async () => {
  const llmCalls = [];
  t.llm.respond = (payload) => {
    llmCalls.push(payload);
    const m = /Source 1 says: "(.*)" \(value[\s\S]*Source 2 says: "(.*)" \(value/.exec(payload.messages[1].content);
    const contradict = m && m[1].includes('firmware') !== m[2].includes('firmware');
    return JSON.stringify({ relation: contradict ? 'contradict' : 'compatible', reason: contradict ? 'Different root causes cannot both be true.' : 'Same event described differently.' });
  };
  const email = 'limits@test.local';
  const token = await t.signup(email, 2);
  const project = (await t.req('POST', '/projects', { token, body: { name: 'Limits' } })).data;
  await attach(token, project._id, 'prose2-l0.txt', 0);
  await attach(token, project._id, 'chat2-l0.txt', 0);
  await attach(token, project._id, 'sys-l0.log', 0, 'syslog');

  const status = await analyze(token, project._id);
  assert.equal(status.status, 'DONE', status.error);
  assert.equal(status.stats.logEventsLabelled, 2, 'only notable log events are sent for labelling');
  assert.equal(workerCalls.labels, 2, 'routine events ("cron job executed") are never labelled');
  assert.equal(status.stats.textPairsJudged, 2, 'two cross-source cause pairs; the two chat statements share a source and are not compared');

  const conflicts = (await t.req('GET', `/projects/${project._id}/conflicts`, { token })).data;
  const summary = conflicts.map((c) => `${c.field}|${c.kind}`).sort();
  assert.deepEqual(summary, [
    'cause|status',                                // failed disk controller (report) vs bad firmware update (chat)
    'outage end time|temporal',                    // chat 03:18 vs the log's latest recovery event
    'outage start time|temporal',                  // report 02:14 vs the log's earliest failure event
    'person responsible|attribution',              // Priya Raman vs Marco Silva, decided by entity resolution
  ]);

  const start = conflicts.find((c) => c.field === 'outage start time');
  assert.equal(start.b.filename === 'sys-l0.log' || start.a.filename === 'sys-l0.log', true);
  const logSide = start.a.filename === 'sys-l0.log' ? start.a : start.b;
  assert.match(logSide.quote, /disk controller reset failed/);
  assert.ok(logSide.loc.line === 1 && logSide.loc.ts, 'log side carries its location');
  assert.match(start.explanation, /17\.1 minutes/);
  assert.match(start.explanation, /system-log event/);
  assert.match(conflicts.find((c) => c.kind === 'attribution').explanation, /different entities/);
  const firmware = conflicts.filter((c) => c.field === 'cause');
  assert.ok(firmware.every((c) => /Different root causes/.test(c.explanation)));
  assert.ok(!conflicts.some((c) => `${c.a.value}|${c.b.value}`.match(/failed disk controller\|disk controller errors|disk controller errors\|failed disk controller/)), 'compatible wordings are not conflicts');

  // coverage gaps are visible, not silent
  const gaps = (await t.req('GET', `/projects/${project._id}/gaps`, { token })).data;
  assert.equal(gaps.length, 1);
  assert.deepEqual(gaps[0].values, ['4,200 dollars', '30 minutes']);
  assert.ok(gaps[0].loc.line && gaps[0].filename === 'prose2-l0.txt');
  assert.equal(status.stats.unitsWithUncomparedValues, 1);

  // a re-run asks the model nothing new and labels nothing new
  const before = { llm: llmCalls.length, labels: workerCalls.labels };
  const again = await analyze(token, project._id);
  assert.equal(llmCalls.length, before.llm, 'text pairs are cached');
  assert.equal(workerCalls.labels, before.labels, 'log events are labelled once per vocabulary');
  assert.equal(again.stats.logEventsLabelled, 0);
  assert.equal((await t.req('GET', `/projects/${project._id}/conflicts`, { token })).data.length, 4);

  // clearance applies to every new surface
  await t.req('POST', `/projects/${project._id}/entities/decisions`, { token, body: { keyA: 'PERSON|marco silva', keyB: 'PERSON|priya raman', decision: 'split' } });
  await setClearance(email, 0);
  assert.equal((await t.req('GET', `/projects/${project._id}/gaps`, { token })).data.length, 1, 'level-0 material stays visible');
  await t.mongoose.connection.collection('evidenceunits').updateMany({ projectId: new t.mongoose.Types.ObjectId(project._id), text: /Costs were/ }, { $set: { classification: 2 } });
  assert.equal((await t.req('GET', `/projects/${project._id}/gaps`, { token })).data.length, 0, 'gaps in higher-level units are hidden');
});

test('concurrent analysis runs are refused', async () => {
  const token = await t.signup('busy@test.local', 1);
  const project = (await t.req('POST', '/projects', { token, body: { name: 'B' } })).data;
  await t.mongoose.connection.collection('projects').updateOne({ _id: new t.mongoose.Types.ObjectId(project._id) }, { $set: { 'analysis.status': 'RUNNING' } });
  assert.equal((await t.req('POST', `/projects/${project._id}/analysis`, { token, body: {} })).status, 409);
});

test('analysis filters: only sentences that state a value or name something reach the model', () => {
  const { worthFacts, worthEntities, interleaveByDocument } = require('../services/analysisFilters');
  assert.ok(worthFacts('The outage began at 02:14 UTC and lasted 47 minutes.'));
  assert.ok(worthFacts('Our model achieves 28.4 BLEU on the WMT 2014 English-to-German task.'));
  assert.ok(!worthFacts('We describe the architecture in the following section.'), 'no number');
  assert.ok(worthFacts('The on-call engineer R. Tanaka restored service.'), 'ownership statements need no number');
  assert.ok(worthFacts('Aisha Petrov owns this incident and will write the review.'));
  assert.ok(!worthFacts('As shown in [12] and [3, 4] the approach is general and works well.'), 'a citation marker is not a value');
  assert.ok(!worthFacts('Jacob Devlin, Ming-Wei Chang. 2018. BERT: Pre-training. arXiv preprint arXiv:1810.04805.'), 'bibliography entries are skipped');
  assert.ok(!worthFacts('Table 3'), 'too short');
  assert.ok(worthEntities('The on-call engineer Priya Raman restored service.'));
  assert.ok(worthEntities('We fine-tune BERT on every task in the benchmark.'));
  assert.ok(!worthEntities('the model is trained for several epochs with a small learning rate.'));
  const { selectWorthy } = require('../services/analysisFilters');
  const small = Array.from({ length: 5 }, (_, i) => ({ documentId: 's', text: `filler ${i}` }));
  assert.equal(selectWorthy(small, () => false).length, 5, 'a short source is read in full');
  const big = Array.from({ length: 100 }, (_, i) => ({ documentId: 'p', text: i % 2 ? 'the run took 12 minutes in total' : 'plain words about the method used' }));
  assert.equal(selectWorthy(big, worthFacts).length, 50, 'a long paper keeps only worthy sentences');
  const mixed = [{ documentId: 'a', n: 1 }, { documentId: 'a', n: 2 }, { documentId: 'a', n: 3 }, { documentId: 'b', n: 1 }];
  assert.deepEqual(interleaveByDocument(mixed).map((u) => `${u.documentId}${u.n}`), ['a1', 'b1', 'a2', 'a3']);
});

test('facts from long documents are compared only when they are about the same specific subject', () => {
  const { strictSubjectsMatch, buildConflicts } = require('../services/facts');
  const f = (doc, subject, field, value, type = 'number') => ({ unit: { _id: `${doc}-${subject}-${value}`, documentId: doc, textSha256: `${doc}${subject}${value}`, classification: 0 }, fact: { subject, field, value, type, quote: `${subject} ${field} ${value}` } });
  const s = (subject) => ({ fact: { subject } });
  assert.ok(!strictSubjectsMatch(s('bert'), s('bert base')), 'a variant is a different thing');
  assert.ok(strictSubjectsMatch(s('BERT large'), s('bert-large')));
  assert.ok(!strictSubjectsMatch(s('bert large glue'), s('bert base glue')), 'different variants');
  assert.ok(!strictSubjectsMatch(s('bert'), s('electra')));
  assert.ok(!strictSubjectsMatch(s('paper'), s('paper')), 'a generic subject names nothing in particular');
  assert.ok(!strictSubjectsMatch(s(''), s('bert')));
  assert.ok(!strictSubjectsMatch(s('arxiv paper'), s('arxiv:2003.10555v1 [cs.cl]')), 'an arXiv stamp is not a subject');
  assert.ok(!strictSubjectsMatch(s('training'), s('model training')), 'a bare generic word names nothing in particular');

  // same field and different numbers: a conflict between small documents, none between unrelated subjects of long ones
  const entries = [f('a', 'bert', 'glue score', '80.5'), f('b', 'electra', 'glue score', '84.4')];
  assert.equal(buildConflicts(entries, {}).length, 1, 'permissive between short sources, as before');
  assert.equal(buildConflicts(entries, { strictDocs: new Set(['a']) }).length, 0, 'unrelated subjects in long documents');
  const same = [f('a', 'bert base', 'parameters', '110', 'number'), f('b', 'bert base', 'parameters', '340', 'number')];
  assert.equal(buildConflicts(same, { strictDocs: new Set(['a', 'b']) }).length, 1, 'the same subject still conflicts');
});

test('long-document facts: identical field, plain numbers, more than rounding, no cross-paper dates', () => {
  const { buildConflicts } = require('../services/facts');
  const f = (doc, subject, field, value, type = 'number') => ({ unit: { _id: `${doc}${subject}${value}`, documentId: doc, textSha256: `${doc}${value}`, classification: 0 }, fact: { subject, field, value, type, quote: `${field} ${value}` } });
  const strict = { strictDocs: new Set(['a', 'b']) };
  const run = (x, y) => buildConflicts([x, y], strict).length;
  assert.equal(run(f('a', 'bert large', 'mnli accuracy', '86.7%'), f('b', 'bert large', 'mnli accuracy', '80.1')), 1, 'a real disagreement is kept');
  assert.equal(run(f('a', 'bert large', 'mnli accuracy', '83.1'), f('b', 'bert large', 'mnli accuracy', '83.0')), 0, 'rounding noise');
  assert.equal(run(f('a', 'bert large', 'mnli accuracy', '86.7'), f('b', 'bert large', 'mnli test accuracy', '80.1')), 0, 'different field names');
  assert.equal(run(f('a', 'elmo', 'compute', '59.1'), f('b', 'elmo', 'compute', '3.3e18 / 2.6e10')), 0, 'not a plain number');
  assert.equal(run(f('a', 'arxiv paper', 'publication date', '24 May 2019', 'date'), f('b', 'arxiv paper', 'publication date', '23 Mar 2020', 'date')), 0, 'dates of different papers');
});
