// Boots the API against a throwaway database and a stub worker. Used by integration tests.
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mongoose = require('mongoose');

const MONGO = process.env.MONGO_TEST_URI || 'mongodb://localhost:27017/mirage_test';

async function boot({ port, workerPort, workerHandler, llmPort }) {
  const base = `http://127.0.0.1:${port}/api`;
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirage-test-'));
  await mongoose.connect(MONGO);
  await mongoose.connection.dropDatabase();

  const workerCalls = [];
  const worker = http.createServer((rq, rs) => {
    let body = '';
    rq.on('data', (c) => (body += c));
    rq.on('end', () => {
      const payload = JSON.parse(body || '{}');
      workerCalls.push(payload);
      let reply;
      try { reply = workerHandler(payload, rq.url, { storageDir }); } catch (err) { reply = { status: 500, json: { detail: `stub worker error: ${err.message}` } }; } // never leave the client hanging
      const { status = 200, json } = reply;
      rs.statusCode = status;
      rs.setHeader('Content-Type', 'application/json');
      rs.end(JSON.stringify(json));
    });
  }).listen(workerPort);

  // Stub Ollama: records every prompt so tests can prove what the model was (not) shown.
  const llmCalls = [];
  const llm = { respond: () => '{"claims":[]}' };
  let llmServer;
  if (llmPort) {
    llmServer = http.createServer((rq, rs) => {
      let body = '';
      rq.on('data', (c) => (body += c));
      rq.on('end', () => {
        const payload = JSON.parse(body || '{}');
        llmCalls.push(payload);
        rs.setHeader('Content-Type', 'application/json');
        rs.end(JSON.stringify({ message: { content: llm.respond(payload, llmCalls.length) } }));
      });
    }).listen(llmPort);
  }

  const server = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: port, MONGO_URI: MONGO, JWT_SECRET: 'test-secret-test-secret', STORAGE_DIR: storageDir, WORKER_URL: `http://127.0.0.1:${workerPort}`, ...(llmPort ? { OLLAMA_URL: `http://127.0.0.1:${llmPort}` } : {}) },
    stdio: 'pipe',
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 200));
    if (i === 49) throw new Error('server did not start');
  }

  const req = async (method, url, { token, body, form } = {}) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + url, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
    let data = null;
    try { data = await res.clone().json(); } catch { /* binary */ }
    return { status: res.status, data, res };
  };

  const signup = async (email, clearance = 0) => {
    const { data } = await req('POST', '/auth/signup', { body: { email, password: 'password1' } });
    if (clearance) await mongoose.connection.collection('users').updateOne({ email }, { $set: { clearance } });
    return data.token;
  };

  const store = async (token, name, content) => {
    const form = new FormData();
    form.append('file', new Blob([content]), name);
    return req('POST', '/files', { token, form });
  };

  const waitFor = async (fn, ms = 5000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() > end) throw new Error('timeout waiting for condition');
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  const close = async () => {
    server.kill();
    worker.close();
    if (llmServer) llmServer.close();
    await mongoose.disconnect();
    fs.rmSync(storageDir, { recursive: true, force: true });
  };

  return { storageDir, req, signup, store, waitFor, close, workerCalls, llm, llmCalls, mongoose };
}

module.exports = { boot };
