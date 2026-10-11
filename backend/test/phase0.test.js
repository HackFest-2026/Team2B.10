// Phase 0 acceptance: auth/ownership on every route, local storage, tamper-evident audit, no external calls.
// Needs a MongoDB at MONGO_TEST_URI (default mongodb://localhost:27017/mirage_test). Run: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mongoose = require('mongoose');

const PORT = 5099;
const WORKER_PORT = 5098;
const BASE = `http://127.0.0.1:${PORT}/api`;
const MONGO = process.env.MONGO_TEST_URI || 'mongodb://localhost:27017/mirage_test';
const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirage-test-'));
let server, worker;

const req = async (method, url, { token, body, form } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + url, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  let data = null;
  try { data = await res.clone().json(); } catch { /* binary */ }
  return { status: res.status, data, res };
};

const signup = async (email) => (await req('POST', '/auth/signup', { body: { email, password: 'password1' } })).data.token;

before(async () => {
  await mongoose.connect(MONGO);
  await mongoose.connection.dropDatabase();
  // Stub worker: returns a canned processing result so nothing needs Python/Ollama.
  worker = http.createServer((rq, rs) => {
    rs.setHeader('Content-Type', 'application/json');
    rs.end(JSON.stringify({ pageCount: 1, chunks: [], insights: [], annotatedStorageKey: null }));
  }).listen(WORKER_PORT);
  server = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: PORT, MONGO_URI: MONGO, JWT_SECRET: 'test-secret-test-secret', STORAGE_DIR: storageDir, WORKER_URL: `http://127.0.0.1:${WORKER_PORT}` },
    stdio: 'pipe',
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not start');
});

after(async () => {
  server.kill();
  worker.close();
  await mongoose.disconnect();
  fs.rmSync(storageDir, { recursive: true, force: true });
});

test('server refuses to start without JWT_SECRET', () => {
  // Run from an empty directory: server.js loads ./.env, and a developer's real backend/.env must not leak into this test.
  const r = spawnSync('node', [path.join(__dirname, '..', 'server.js')], { cwd: os.tmpdir(), env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 10000 });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /JWT_SECRET/);
});

test('every API route rejects unauthenticated requests', async () => {
  const id = '64b000000000000000000001';
  const routes = [
    ['GET', '/projects'], ['POST', '/projects'], ['GET', `/projects/${id}`], ['DELETE', `/projects/${id}`],
    ['POST', `/projects/${id}/summary`], ['GET', `/projects/${id}/summary`], ['GET', `/projects/${id}/knowledge-graph`],
    ['POST', '/files'], ['GET', '/files/' + 'a'.repeat(32) + '.pdf'], ['POST', `/projects/${id}/upload`],
    ['GET', `/projects/${id}/documents`], ['GET', `/projects/${id}/documents/${id}/insights`],
    ['POST', `/projects/${id}/documents/${id}/insights`], ['GET', `/documents/${id}`], ['POST', `/projects/${id}/chat`], ['GET', '/audit'],
    ['GET', `/projects/${id}/facts`], ['GET', `/projects/${id}/gaps`], ['GET', `/projects/${id}/conflicts`], ['GET', `/projects/${id}/entities`], ['GET', `/projects/${id}/drafts`],
    ['POST', `/projects/${id}/drafts`], ['GET', `/projects/${id}/drafts/${id}`], ['POST', `/projects/${id}/drafts/${id}/export`], ['GET', `/projects/${id}/exports/${id}/pdf`],
    ['POST', '/verify'], ['GET', '/signing-key'],
  ];
  for (const [m, u] of routes) {
    const { status } = await req(m, u);
    assert.equal(status, 401, `${m} ${u} should be 401, got ${status}`);
  }
});

test('users cannot see or touch each other\'s projects, documents or files', async () => {
  const a = await signup('a@test.local');
  const b = await signup('b@test.local');

  const project = (await req('POST', '/projects', { token: a, body: { name: 'A project', userId: 'someone-else' } })).data;
  assert.equal((await req('GET', '/projects', { token: b })).data.length, 0);

  // A uploads a file and attaches it
  const form = new FormData();
  form.append('file', new Blob(['%PDF-1.4 secret'], { type: 'application/pdf' }), 'secret.pdf');
  const stored = await req('POST', '/files', { token: a, form });
  assert.equal(stored.status, 201);
  const { fileUrl } = stored.data;

  const doc = (await req('POST', `/projects/${project._id}/upload`, { token: a, body: { fileUrl, filename: 'secret.pdf' } })).data;
  assert.ok(doc._id);
  assert.equal(doc.sha256.length, 64);

  // B is blocked everywhere
  const pid = project._id;
  const denied = [
    ['GET', `/projects/${pid}`], ['DELETE', `/projects/${pid}`], ['POST', `/projects/${pid}/summary`],
    ['GET', `/projects/${pid}/summary`], ['GET', `/projects/${pid}/knowledge-graph`], ['GET', `/projects/${pid}/documents`],
    ['POST', `/projects/${pid}/chat`], ['GET', `/projects/${pid}/documents/${doc._id}/insights`],
    ['GET', `/documents/${doc._id}`], ['GET', fileUrl.replace('/api', '')],
  ];
  for (const [m, u] of denied) {
    const { status } = await req(m, u, { token: b, body: m === 'POST' ? { message: 'x' } : undefined });
    assert.equal(status, 404, `${m} ${u} must be 404 for non-owner, got ${status}`);
  }
  // B cannot attach A's stored file to B's own project, and cannot reach A's document through B's project
  const bProject = (await req('POST', '/projects', { token: b, body: { name: 'B' } })).data;
  assert.equal((await req('POST', `/projects/${bProject._id}/upload`, { token: b, body: { fileUrl, filename: 'x.pdf' } })).status, 409);
  assert.equal((await req('GET', `/projects/${bProject._id}/documents/${doc._id}/insights`, { token: b })).status, 404);

  // A still has access
  assert.equal((await req('GET', `/projects/${pid}`, { token: a })).status, 200);
  const dl = await req('GET', fileUrl.replace('/api', ''), { token: a });
  assert.equal(dl.status, 200);
  assert.match(await dl.res.text(), /secret/);

  // External URLs are rejected as document sources
  const ext = await req('POST', `/projects/${pid}/upload`, { token: a, body: { fileUrl: 'https://example.com/x.pdf', filename: 'x.pdf' } });
  assert.equal(ext.status, 400);
});

test('audit chain verifies, and detects tampering', async () => {
  const a = await signup('audit@test.local');
  const first = (await req('GET', '/audit', { token: a })).data;
  assert.equal(first.integrity.valid, true);
  assert.ok(first.integrity.checked > 3);
  assert.ok(first.entries.some((e) => e.action === 'SIGNUP'));

  await mongoose.connection.collection('audits').updateOne({ seq: 2 }, { $set: { action: 'FORGED' } });
  const after = (await req('GET', '/audit', { token: a })).data;
  assert.equal(after.integrity.valid, false);
  assert.equal(after.integrity.brokenAtSeq, 2);
});

test('no hosted-service endpoints remain in the source', () => {
  const root = path.join(__dirname, '..', '..');
  const banned = /openrouter|uploadthing|cdnjs|googleapis|gstatic/i;
  const skip = new Set(['node_modules', '.git', '.venv', 'venv', 'build', 'test', 'docs', 'vendor', 'corpus', 'results', 'storage', 'keys']);
  const hits = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(f.name) || f.name === 'package-lock.json' || f.name === 'README.md') continue;
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (/\.(js|jsx|py|html|css|yml|json|example)$/.test(f.name) && banned.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(root, p));
    }
  };
  walk(root);
  assert.deepEqual(hits, []);
});
