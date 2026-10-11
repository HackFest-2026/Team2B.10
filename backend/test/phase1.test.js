// Phase 1 acceptance: every source type ingests with inspectable locations; bad input becomes a visible error.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./helpers');

let t;
const unit = (text, loc, extra = {}) => ({ text, textSha256: 'a'.repeat(64), loc, fields: {}, parseStatus: 'ok', embedding: [0.1, 0.2], ...extra });

before(async () => {
  t = await boot({
    port: 5097,
    workerPort: 5096,
    workerHandler: (p) => {
      if (p.filename === 'empty.txt') return { status: 422, json: { detail: 'File is empty' } };
      const loc = { scan: { page: 1, bbox: [1, 2, 3, 4] }, report: { line: 1 }, chatlog: { turn: 1, speaker: 'A', line: 1 }, syslog: { line: 1, eventId: 'L1' } }[p.sourceType];
      return {
        json: {
          pageCount: p.sourceType === 'scan' ? 2 : null,
          insights: [],
          annotatedStorageKey: null,
          units: [unit(`${p.sourceType} unit one`, loc, p.sourceType === 'scan' ? { confidence: 55.5, fields: { lowConfidence: true } } : {}),
                  unit(`${p.sourceType} unit two`, { ...loc, line: 2 }, { parseStatus: p.sourceType === 'syslog' ? 'raw' : 'ok' })],
          ocrConfidence: p.sourceType === 'scan' ? 55.5 : null,
          warnings: p.sourceType === 'scan' ? ['1 OCR paragraphs have low confidence'] : [],
        },
      };
    },
  });
});

after(() => t.close());

const attach = async (token, projectId, filename, sourceType, classification, content = 'data') => {
  const { data: { fileUrl } } = await t.store(token, filename, content);
  return t.req('POST', `/projects/${projectId}/upload`, { token, body: { fileUrl, filename, sourceType, classification } });
};

test('all four source types ingest and expose units with locations', async () => {
  const token = await t.signup('ingest@test.local', 2);
  const project = (await t.req('POST', '/projects', { token, body: { name: 'P' } })).data;

  const cases = [['scan.pdf', 'scan'], ['report.md', 'report'], ['chat.txt', 'chatlog'], ['sys.log', 'syslog']];
  for (const [file, type] of cases) {
    const r = await attach(token, project._id, file, type, 1);
    assert.equal(r.status, 201, `${file}: ${JSON.stringify(r.data)}`);
    assert.equal(r.data.sourceType, type);
    assert.equal(r.data.classification, 1);
    const doc = await t.waitFor(async () => {
      const d = (await t.req('GET', `/documents/${r.data._id}`, { token })).data;
      return d.status === 'DONE' ? d : null;
    });
    assert.equal(doc.unitCount, 2);

    const units = (await t.req('GET', `/projects/${project._id}/documents/${doc._id}/units`, { token })).data;
    assert.equal(units.total, 2);
    assert.ok(units.units[0].loc && Object.keys(units.units[0].loc).length, 'unit has a source location');
    assert.equal(units.units[0].classification, 1, 'units inherit the source classification');
    assert.equal(units.units[0].embedding, undefined, 'embeddings are not exposed');
  }

  // worker received the metadata it needs
  assert.deepEqual(t.workerCalls.map((c) => c.sourceType).sort(), ['chatlog', 'report', 'scan', 'syslog']);
  assert.ok(t.workerCalls.every((c) => c.filename && c.storageKey));

  // scan: OCR confidence + warnings surface; filters work
  const docs = (await t.req('GET', `/projects/${project._id}/documents`, { token })).data;
  const scan = docs.find((d) => d.sourceType === 'scan');
  assert.equal(scan.ocrConfidence, 55.5);
  assert.equal(scan.pageCount, 2);
  assert.match(scan.warnings[0], /low confidence/);
  const low = (await t.req('GET', `/projects/${project._id}/documents/${scan._id}/units?lowConfidence=true`, { token })).data;
  assert.equal(low.total, 1);
  const sys = docs.find((d) => d.sourceType === 'syslog');
  const raw = (await t.req('GET', `/projects/${project._id}/documents/${sys._id}/units?raw=true`, { token })).data;
  assert.equal(raw.total, 1);
  const search = (await t.req('GET', `/projects/${project._id}/documents/${sys._id}/units?q=${encodeURIComponent('unit (two')}`, { token })).data;
  assert.equal(search.total, 0, 'regex characters in search are escaped');
});

test('unreadable or unsupported inputs produce a visible error, never silent ingestion', async () => {
  const token = await t.signup('errors@test.local', 3);
  const project = (await t.req('POST', '/projects', { token, body: { name: 'E' } })).data;

  // worker rejects -> ERROR status with the worker's explanation, no units stored
  const r = await attach(token, project._id, 'empty.txt', 'syslog', 0, 'x');
  const doc = await t.waitFor(async () => {
    const d = (await t.req('GET', `/documents/${r.data._id}`, { token })).data;
    return d.status !== 'PROCESSING' ? d : null;
  });
  assert.equal(doc.status, 'ERROR');
  assert.equal(doc.errorMessage, 'File is empty');
  assert.equal((await t.req('GET', `/projects/${project._id}/documents/${doc._id}/units`, { token })).data.total, 0);

  // unsupported extension at upload time
  const exe = await t.store(token, 'malware.exe', 'MZ');
  assert.equal(exe.status, 415);
  // extension/type mismatch
  assert.equal((await attach(token, project._id, 'photo.png', 'syslog', 0)).status, 400);
  assert.equal((await attach(token, project._id, 'notes.txt', 'nonsense', 0)).status, 400);
  // bad classification values
  assert.equal((await attach(token, project._id, 'a.txt', 'report', 7)).status, 400);
  assert.equal((await attach(token, project._id, 'b.txt', 'report', 'high')).status, 400);
});

test('users cannot label uploads above their clearance, and units are owner-only', async () => {
  const low = await t.signup('low@test.local', 1);
  const owner = await t.signup('owner@test.local', 3);
  const other = await t.signup('other@test.local', 3);
  const project = (await t.req('POST', '/projects', { token: low, body: { name: 'L' } })).data;

  const denied = await attach(low, project._id, 'secret.txt', 'report', 2);
  assert.equal(denied.status, 403);
  assert.equal((await t.req('GET', `/projects/${project._id}/documents`, { token: low })).data.length, 0, 'nothing was created');
  assert.equal((await attach(low, project._id, 'ok.txt', 'report', 1)).status, 201);

  const ownerProject = (await t.req('POST', '/projects', { token: owner, body: { name: 'O' } })).data;
  const r = await attach(owner, ownerProject._id, 'top.txt', 'report', 3);
  await t.waitFor(async () => (await t.req('GET', `/documents/${r.data._id}`, { token: owner })).data.status === 'DONE');
  const url = `/projects/${ownerProject._id}/documents/${r.data._id}/units`;
  assert.equal((await t.req('GET', url, { token: owner })).status, 200);
  assert.equal((await t.req('GET', url, { token: other })).status, 404);

  // denial and upload are in the audit trail
  const entries = (await t.req('GET', '/audit', { token: low })).data.entries.map((e) => e.action);
  assert.ok(entries.includes('ACCESS_DENIED'));
  assert.ok(entries.includes('DOCUMENT_UPLOAD'));
});
