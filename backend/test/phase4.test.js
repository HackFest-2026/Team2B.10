// Phase 4 acceptance: every statement of an exported document resolves to source passages, unsupported statements
// are identified and kept out of the findings, and changing a source or the manifest breaks verification.
process.env.JWT_SECRET ||= 'test-secret-test-secret';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { boot } = require('./helpers');

let t;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const words = (s) => new Set(s.toLowerCase().match(/[a-z0-9,.:]+/g) || []);
const nliMode = { down: false };

const TEXTS = {
  'report-l0.txt': ['The outage began at 02:14 UTC on atlas-db-02.', 'Roughly 12,400 sessions were affected.'],
  'chat-l0.txt': ['Marco Silva: Around 9,800 sessions were affected.'],
  'secret-l2.txt': ['Secret addendum: the vendor contract number is VX-7781.'],
};

before(async () => {
  t = await boot({
    port: 5085, workerPort: 5084, llmPort: 5083,
    workerHandler: (p, url, ctx) => {
      if (url === '/embed') return { json: { embedding: [0.1, 0.2] } };
      if (url === '/nli') {
        if (nliMode.down) return { status: 500, json: { detail: 'model not loaded' } };
        // stand-in for the entailment model: a hypothesis is entailed when all its words occur in the premise
        return { json: { results: p.pairs.map(({ premise, hypothesis }) => {
          const prem = words(premise);
          const ok = [...words(hypothesis)].every((w) => prem.has(w));
          return ok ? { entailment: 0.97, contradiction: 0.01, neutral: 0.02 } : { entailment: 0.04, contradiction: 0.06, neutral: 0.9 };
        }) } };
      }
      if (url === '/render-pdf') {
        const key = `${crypto.randomBytes(16).toString('hex')}.pdf`;
        fs.writeFileSync(path.join(ctx.storageDir, key), `%PDF-1.4 stub\n${JSON.stringify(p.spec)}`);
        return { json: { storageKey: key, pages: 2 } };
      }
      return { json: { pageCount: null, insights: [], annotatedStorageKey: null, ocrConfidence: null, warnings: [],
        units: (TEXTS[p.filename] || []).map((text, i) => ({ text, textSha256: sha(text), loc: { line: i + 1 }, fields: {}, parseStatus: 'ok', embedding: [0.1, 0.2] })) } };
    },
  });

  // The model writes one claim per supplied unit, plus two bad ones in the first section.
  t.llm.respond = (payload) => {
    const content = payload.messages[1].content;
    const units = [...content.matchAll(/^\[(\d+)\] \(([^)]*)\) (.*)$/gm)].map((m) => ({ n: Number(m[1]), text: m[3] }));
    const claims = units.map((u) => ({ claim: u.text.replace(/^Marco Silva:\s*/, ''), evidence: [{ unit: u.n, quote: u.text.slice(0, 60) }] }));
    if (/Section: Summary/.test(content) && units.length) {
      claims.push({ claim: 'The vendor invoiced 40,000 dollars.', evidence: [{ unit: 1, quote: 'this sentence is not in any source' }] }); // fabricated quote
      claims.push({ claim: 'The sources do not disagree about anything.', evidence: [{ unit: 1, quote: units[0].text.slice(0, 30) }] });  // real quote, claim not entailed
    }
    return JSON.stringify({ claims });
  };
});
after(() => t.close());

const attach = async (token, projectId, filename, classification) => {
  const { data: { fileUrl } } = await t.store(token, filename, `content of ${filename}`);
  const r = await t.req('POST', `/projects/${projectId}/upload`, { token, body: { fileUrl, filename, sourceType: 'report', classification } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  await t.waitFor(async () => (await t.req('GET', `/documents/${r.data._id}`, { token })).data.status === 'DONE');
  return r.data;
};
const setClearance = (email, level) => t.mongoose.connection.collection('users').updateOne({ email }, { $set: { clearance: level } });
const pdfSpec = async (token, pid, exp) => {
  const r = await t.req('GET', exp.pdfUrl.replace('/api', ''), { token });
  assert.equal(r.status, 200);
  const text = await r.res.text();
  return { text, spec: JSON.parse(text.slice(text.indexOf('\n') + 1)) };
};

async function seed(email, clearance = 3) {
  const token = await t.signup(email, clearance);
  const project = (await t.req('POST', '/projects', { token, body: { name: 'P' } })).data;
  const report = await attach(token, project._id, 'report-l0.txt', 0);
  const chat = await attach(token, project._id, 'chat-l0.txt', 0);
  const secret = await attach(token, project._id, 'secret-l2.txt', 2);
  // one recorded conflict between the 12,400 and 9,800 statements
  const units = await t.mongoose.connection.collection('evidenceunits').find({ projectId: new t.mongoose.Types.ObjectId(project._id) }).toArray();
  const a = units.find((u) => u.text.includes('12,400'));
  const b = units.find((u) => u.text.includes('9,800'));
  await t.mongoose.connection.collection('conflicts').insertOne({
    projectId: a.projectId, pairKey: `k-${email}`, unitA: a._id, unitB: b._id, docA: a.documentId, docB: b.documentId, classification: 0, kind: 'value',
    field: 'sessions affected', valueA: '12,400', valueB: '9,800', quoteA: 'Roughly 12,400 sessions', quoteB: 'Around 9,800 sessions', supportA: 1, supportB: 1, status: 'open', explanation: 'x', detectedAt: new Date(),
  });
  return { token, project, report, chat, secret };
}

async function generate(token, projectId, body = {}) {
  const r = await t.req('POST', `/projects/${projectId}/drafts`, { token, body: { title: 'Incident INC-2041', template: 'incident', ...body } });
  assert.equal(r.status, 202, JSON.stringify(r.data));
  return t.waitFor(async () => {
    const d = (await t.req('GET', `/projects/${projectId}/drafts/${r.data.id}`, { token })).data;
    return d.status === 'GENERATING' ? null : d;
  }, 15000);
}
const claimsOf = (draft) => draft.sections.flatMap((s) => s.claims);

test('generation: verbatim-quoted AND entailed claims become findings; the rest are identified, never presented as verified', async () => {
  nliMode.down = false;
  const { token, project } = await seed('gen@test.local');
  const draft = await generate(token, project._id);
  assert.equal(draft.status, 'READY', draft.error);

  const claims = claimsOf(draft);
  const byText = (re) => claims.find((c) => re.test(c.text));
  assert.equal(byText(/began at 02:14/).status, 'supported');
  assert.equal(byText(/began at 02:14/).evidence[0].quote.startsWith('The outage began'), true);
  assert.ok(byText(/began at 02:14/).entailment > 0.9);
  assert.equal(byText(/12,400 sessions/).status, 'conflicted', 'a supported claim whose evidence is in a recorded conflict is flagged');
  assert.equal(byText(/9,800 sessions/).status, 'conflicted');
  assert.equal(byText(/do not disagree/).status, 'unsupported', 'real quote, but the claim does not follow from it');
  assert.ok(!claims.some((c) => /vendor invoiced/.test(c.text)), 'fabricated quote never becomes a claim');
  assert.ok(draft.rejectedList.some((r) => /vendor invoiced/.test(r.text) && /verbatim/.test(r.reason)));
  assert.ok(claims.filter((c) => c.status === 'supported' || c.status === 'conflicted').every((c) => c.evidence.length >= 1));

  const conflictClaim = draft.sections.find((s) => s.key === 'conflicts').claims[0];
  assert.equal(conflictClaim.authored, 'conflict-report');
  assert.match(conflictClaim.text, /report-l0\.txt states "12,400" while chat-l0\.txt states "9,800"/);
  assert.equal(conflictClaim.evidence.length, 2);

  assert.equal(draft.stats.unsupported, 1);
  assert.equal(draft.stats.rejected, 1, 'only the fabricated quote is rejected outright');
  assert.equal(draft.classification, 2);
  assert.ok(draft.model.nli && draft.model.llm);

  // honest failure: no document is produced when the entailment model is down
  nliMode.down = true;
  const failed = await generate(token, project._id, { title: 'No NLI' });
  nliMode.down = false;
  assert.equal(failed.status, 'ERROR');
  assert.match(failed.error, /entailment model unavailable/);
});

test('editing re-verifies statements, is audited, and unsourced additions are flagged as such', async () => {
  const { token, project } = await seed('edit@test.local');
  const draft = await generate(token, project._id);
  const base = `/projects/${project._id}/drafts/${draft.id}`;
  const supported = claimsOf(draft).find((c) => c.status === 'supported');

  // an edit that the evidence still entails keeps the statement verified
  let r = await t.req('PATCH', `${base}/claims/${supported.id}`, { token, body: { text: supported.text.replace('began', 'began') } });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'supported');
  // an edit that goes beyond the evidence is demoted
  r = await t.req('PATCH', `${base}/claims/${supported.id}`, { token, body: { text: 'The outage began at 02:14 UTC and was caused by a firmware bug.' } });
  assert.equal(r.data.status, 'unsupported');
  assert.equal(r.data.version, 3);

  // unsourced addition = clearly an analyst note; sourced addition is verified; bad quote is refused
  const section = draft.sections[0].key;
  r = await t.req('POST', `${base}/claims`, { token, body: { sectionKey: section, text: 'Follow up with the vendor next week.' } });
  assert.equal(r.data.status, 'human');
  assert.equal((await t.req('POST', `${base}/claims`, { token, body: { sectionKey: section, text: 'x', classification: 9 } })).status, 400);
  const unit = await t.mongoose.connection.collection('evidenceunits').findOne({ projectId: new t.mongoose.Types.ObjectId(project._id), text: /12,400/ });
  r = await t.req('POST', `${base}/claims`, { token, body: { sectionKey: section, text: 'Roughly 12,400 sessions were affected.', evidence: [{ unitId: String(unit._id), quote: 'Roughly 12,400 sessions' }] } });
  assert.equal(r.data.status, 'supported');
  assert.equal((await t.req('POST', `${base}/claims`, { token, body: { sectionKey: section, text: 'x', evidence: [{ unitId: String(unit._id), quote: 'never said this' }] } })).status, 400);
  assert.equal((await t.req('POST', `${base}/claims`, { token, body: { sectionKey: 'nope', text: 'x' } })).status, 400);

  const conflictClaim = draft.sections.find((s) => s.key === 'conflicts').claims[0];
  assert.equal((await t.req('PATCH', `${base}/claims/${conflictClaim.id}`, { token, body: { text: 'rewritten' } })).status, 400, 'generated conflict statements are not hand-editable');
  assert.equal((await t.req('DELETE', `${base}/claims/${conflictClaim.id}`, { token })).status, 200);

  const after = (await t.req('GET', base, { token })).data;
  assert.equal(after.revisions, 5);
  assert.ok(after.stats.editRate > 0 && after.stats.human >= 1);
  const audit = (await t.req('GET', '/audit', { token })).data.entries.filter((e) => e.action === 'DRAFT_EDIT');
  assert.equal(audit.length, 5);
  assert.ok(audit.every((e) => e.meta.version && e.meta.claimId));
  assert.equal((await t.req('GET', '/audit', { token })).data.integrity.valid, true);
});

test('export: PDF holds only verified findings and flagged notes; the signed manifest maps each to its sources; verify passes', async () => {
  const { token, project } = await seed('export@test.local');
  const draft = await generate(token, project._id);
  const base = `/projects/${project._id}/drafts/${draft.id}`;
  await t.req('POST', `${base}/claims`, { token, body: { sectionKey: draft.sections[0].key, text: 'Follow up with the vendor next week.', classification: 0 } });

  const exp = (await t.req('POST', `${base}/export`, { token, body: {} })).data;
  assert.equal(exp.pages, 2);
  const { spec, text } = await pdfSpec(token, project._id, exp);
  const printed = spec.sections.flatMap((s) => s.items.map((i) => i.text));
  assert.ok(printed.some((x) => /began at 02:14/.test(x)));
  assert.ok(!printed.some((x) => /do not disagree/.test(x)), 'unsupported statements stay out of the findings');
  assert.ok(spec.sections.flatMap((s) => s.items).filter((i) => ['supported', 'conflicted'].includes(i.status)).every((i) => i.cites.length >= 1), 'every finding carries a citation');
  assert.ok(spec.sections.flatMap((s) => s.items).some((i) => i.status === 'human' && i.cites.length === 0), 'analyst notes are labelled, uncited');
  assert.ok(spec.sources.every((s) => s.filename && s.location && s.quote && s.sha256));
  assert.equal(spec.classificationName, 'Secret');

  const manifestRes = await t.req('GET', exp.manifestUrl.replace('/api', ''), { token });
  const manifestText = await manifestRes.res.text();
  const { manifest, signature } = JSON.parse(manifestText);
  assert.equal(signature.alg, 'ed25519');
  assert.equal(manifest.pdf.sha256, sha(text));
  assert.equal(manifest.excluded.some((e) => e.status === 'unsupported'), true);
  assert.ok(manifest.claims.every((c) => c.id && c.text && typeof c.classification === 'number'));
  assert.ok(manifest.claims.filter((c) => c.status !== 'human').every((c) => c.evidence.length >= 1 && c.evidence.every((e) => e.unitId && e.quoteSha256 && e.unitSha256)));
  assert.ok(manifest.citations.every((c) => c.loc && c.filename));
  assert.ok(manifest.sources.every((s) => /^[a-f0-9]{64}$/.test(s.sha256)));
  assert.ok(manifest.audit.seq > 0);

  // verification inside the deployment: passes, and is complete for an authorised reader
  const form = () => { const f = new FormData(); f.append('manifest', new Blob([manifestText]), 'manifest.json'); f.append('pdf', new Blob([text]), 'document.pdf'); return f; };
  const ok = (await t.req('POST', '/verify', { token, form: form() })).data;
  assert.equal(ok.valid, true, JSON.stringify(ok.checks.filter((c) => !c.ok)));
  assert.equal(ok.complete, true);
  assert.ok(ok.checks.length > 8);

  // offline verification with only the public key
  const { data: key } = await t.req('GET', '/signing-key', { token });
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'verify-'));
  fs.writeFileSync(path.join(dir, 'm.json'), manifestText); fs.writeFileSync(path.join(dir, 'k.pem'), key.publicKeyPem); fs.writeFileSync(path.join(dir, 'd.pdf'), text);
  const cli = (args) => spawnSync('node', [path.join(__dirname, '..', 'scripts', 'verify-export.js'), ...args], { encoding: 'utf8' });
  assert.equal(cli([path.join(dir, 'm.json'), path.join(dir, 'k.pem'), path.join(dir, 'd.pdf')]).status, 0);

  // ── tampering ──
  // 1. a changed PDF
  const badPdf = form(); badPdf.set('pdf', new Blob([text + ' '], { type: 'application/pdf' }), 'document.pdf');
  let r = (await t.req('POST', '/verify', { token, form: badPdf })).data;
  assert.equal(r.valid, false); assert.deepEqual(r.failed, ['PDF matches the manifest']);
  fs.writeFileSync(path.join(dir, 'd.pdf'), text + ' ');
  assert.equal(cli([path.join(dir, 'm.json'), path.join(dir, 'k.pem'), path.join(dir, 'd.pdf')]).status, 1);

  // 2. a changed manifest: even one claim character
  const forged = JSON.parse(manifestText); forged.manifest.claims[0].text += '!';
  const badManifest = form(); badManifest.set('manifest', new Blob([JSON.stringify(forged)]), 'manifest.json');
  r = (await t.req('POST', '/verify', { token, form: badManifest })).data;
  assert.equal(r.valid, false); assert.deepEqual(r.failed, ['signature matches the manifest']);
  fs.writeFileSync(path.join(dir, 'm.json'), JSON.stringify(forged));
  assert.equal(cli([path.join(dir, 'm.json'), path.join(dir, 'k.pem')]).status, 1);
  const forgedSig = JSON.parse(manifestText); forgedSig.signature.value = Buffer.alloc(64, 1).toString('base64');
  const badSig = form(); badSig.set('manifest', new Blob([JSON.stringify(forgedSig)]), 'manifest.json');
  assert.equal((await t.req('POST', '/verify', { token, form: badSig })).data.valid, false);

  // 3. a changed source file: both verify and any new export refuse it
  const reportDoc = await t.mongoose.connection.collection('documents').findOne({ filename: 'report-l0.txt', projectId: new t.mongoose.Types.ObjectId(project._id) });
  const reportPath = path.join(t.storageDir, reportDoc.fileUrl.split('/').pop());
  const original = fs.readFileSync(reportPath);
  fs.writeFileSync(reportPath, Buffer.concat([original.subarray(0, 1), Buffer.from('X'), original.subarray(2)])); // flip one byte
  r = (await t.req('POST', '/verify', { token, form: form() })).data;
  assert.equal(r.valid, false);
  assert.deepEqual(r.failed, ['source "report-l0.txt" unchanged']);
  assert.equal((await t.req('POST', `${base}/export`, { token, body: {} })).status, 409, 'cannot export from a tampered source');
  fs.writeFileSync(reportPath, original);
  assert.equal((await t.req('POST', '/verify', { token, form: form() })).data.valid, true, 'restoring the byte restores validity');

  // 4. a changed ingested passage (database tampering)
  await t.mongoose.connection.collection('evidenceunits').updateOne({ projectId: new t.mongoose.Types.ObjectId(project._id), text: /began at 02:14/ }, { $set: { text: 'The outage began at 02:15 UTC on atlas-db-02.' } });
  r = (await t.req('POST', '/verify', { token, form: form() })).data;
  assert.equal(r.valid, false);
  assert.ok(r.failed.some((n) => /^passage \[\d+\] unchanged$/.test(n)));
  await t.mongoose.connection.collection('evidenceunits').updateOne({ projectId: new t.mongoose.Types.ObjectId(project._id), text: /began at 02:15/ }, { $set: { text: 'The outage began at 02:14 UTC on atlas-db-02.' } });

  // 5. a rewritten audit trail
  await t.mongoose.connection.collection('audits').updateOne({ seq: 1 }, { $set: { action: 'FORGED' } });
  r = (await t.req('POST', '/verify', { token, form: form() })).data;
  assert.equal(r.valid, false);
  assert.ok(r.failed.includes('audit trail is intact'));
  await t.mongoose.connection.collection('audits').updateOne({ seq: 1 }, { $set: { action: 'SIGNUP' } });

  // exports and verification are audited
  const actions = (await t.req('GET', '/audit', { token })).data.entries.map((e) => e.action);
  assert.ok(actions.includes('DRAFT_EXPORT') && actions.includes('EXPORT_VERIFY') && actions.includes('EXPORT_DOWNLOAD'));
});

test('exports are rendered per reader clearance: higher-level statements are redacted, never leaked, and the result still verifies', async () => {
  const email = 'clear@test.local';
  const { token, project } = await seed(email);
  const draft = await generate(token, project._id);
  const base = `/projects/${project._id}/drafts/${draft.id}`;
  const full = (await t.req('POST', `${base}/export`, { token, body: {} })).data;
  assert.equal(full.classification, 2);
  const fullSpec = (await pdfSpec(token, project._id, full)).text;
  assert.ok(fullSpec.includes('VX-7781'));

  await setClearance(email, 1);
  const view = (await t.req('GET', base, { token })).data;
  assert.ok(view.redacted >= 1);
  assert.ok(!JSON.stringify(view).includes('VX-7781'), 'the draft view hides statements above the reader');
  assert.ok(view.classification <= 1 && !JSON.stringify(view.stats).includes('NaN'));
  const list = (await t.req('GET', `/projects/${project._id}/drafts`, { token })).data;
  assert.ok(!JSON.stringify(list).includes('VX-7781'));

  // the old Secret export is not downloadable or listed at the lower level
  assert.equal((await t.req('GET', full.pdfUrl.replace('/api', ''), { token })).status, 404);
  assert.equal((await t.req('GET', full.manifestUrl.replace('/api', ''), { token })).status, 404);
  assert.equal((await t.req('GET', `${base}/exports`, { token })).data.length, 0);

  const low = (await t.req('POST', `${base}/export`, { token, body: {} })).data;
  assert.ok(low.classification <= 1);
  const { spec, text } = await pdfSpec(token, project._id, low);
  assert.ok(!text.includes('VX-7781') && !text.includes('secret-l2') && !text.includes('Secret addendum'));
  assert.ok(spec.sections.flatMap((s) => s.items).some((i) => i.redacted), 'a placeholder marks that statements were withheld');
  assert.ok(spec.sources.every((s) => s.filename !== 'secret-l2.txt'));
  const manifestText = await (await t.req('GET', low.manifestUrl.replace('/api', ''), { token })).res.text();
  const { manifest } = JSON.parse(manifestText);
  assert.ok(manifest.redactions >= 1 && manifest.classification <= 1 && manifest.reader.clearance === 1);
  assert.ok(!manifestText.includes('VX-7781') && !manifestText.includes('secret-l2'));
  const f = new FormData(); f.append('manifest', new Blob([manifestText]), 'm.json'); f.append('pdf', new Blob([text]), 'd.pdf');
  assert.equal((await t.req('POST', '/verify', { token, form: f })).data.valid, true);

  // edits to a statement above the reader's clearance are impossible
  const secretClaim = claimsOf(draft).find((c) => c.classification === 2);
  assert.equal((await t.req('PATCH', `${base}/claims/${secretClaim.id}`, { token, body: { text: 'overwritten' } })).status, 404);
  assert.equal((await t.req('DELETE', `${base}/claims/${secretClaim.id}`, { token })).status, 404);

  // another user sees nothing
  const other = await t.signup('intruder@test.local', 3);
  assert.equal((await t.req('GET', base, { token: other })).status, 404);
  assert.equal((await t.req('POST', `${base}/export`, { token: other, body: {} })).status, 404);
  assert.equal((await t.req('GET', full.pdfUrl.replace('/api', ''), { token: other })).status, 404);
});

test('chat marks cited sentences the checking pass finds unsupported', async () => {
  const { token, project } = await seed('chat@test.local');
  const draftResponder = t.llm.respond; // the generation tests below rely on it
  t.llm.respond = (payload) => (/strict fact-checker/.test(payload.messages[0].content)
    ? JSON.stringify({ results: [{ i: 1, verdict: 'supported', passages: [1] }, { i: 2, verdict: 'unsupported', passages: [] }] })
    : 'The outage began at 02:14 UTC on atlas-db-02 [1]. The sources do not disagree about anything [1].');
  const r = (await t.req('POST', `/projects/${project._id}/chat`, { token, body: { message: 'outage atlas-db-02' } })).data;
  assert.equal(r.grounding.checked, true);
  assert.equal(r.grounding.unconfirmed, 1);
  assert.match(r.answer, /do not disagree about anything \[1\]\. ⚠/, r.answer);
  t.llm.respond = draftResponder;
});

test('a claim is flagged as conflicted only when it states the disputed value; entailment is checked on sentence windows', () => {
  const { conflictsFor } = require('../services/draftGenerator');
  const { windows } = require('../services/nli');
  const conflicts = [
    { _id: 'c1', unitA: 'u1', unitB: 'u2', valueA: '02:14 UTC', valueB: '02:31' },
    { _id: 'c2', unitA: 'u3', unitB: 'u4', valueA: '12,400', valueB: '2024-03-14 02:49:44 UTC' },
  ];
  assert.deepEqual(conflictsFor('The outage began at 02:14 UTC.', ['u1'], conflicts), ['c1']);
  assert.deepEqual(conflictsFor('The outage lasted 47 minutes.', ['u1'], conflicts), [], 'same paragraph, different fact');
  assert.deepEqual(conflictsFor('The outage began at 02:14 UTC.', ['u9'], conflicts), [], 'must cite the disputed passage');
  assert.deepEqual(conflictsFor('About 12,400 sessions were hit.', ['u3'], conflicts), ['c2']);
  assert.deepEqual(conflictsFor('At 02:49:44 UTC the standby was promoted.', ['u4'], conflicts), ['c2'], 'a log timestamp is matched by its clock time');

  const who = [{ _id: 'c3', unitA: 'u5', unitB: 'u6', kind: 'attribution', valueA: 'R. Tanaka', valueB: 'Aisha Petrov' }];
  assert.deepEqual(conflictsFor('Rahul Tanaka is responsible for the incident.', ['u5'], who), ['c3'], 'a disputed person is matched by surname, however spelled');
  assert.deepEqual(conflictsFor('The Tanakashi job ran.', ['u5'], who), [], 'but not as part of another word');
  assert.deepEqual(conflictsFor('Someone else is responsible.', ['u5'], who), []);

  const text = 'On 2024-03-14 the server failed. The outage began at 02:14 UTC. The incident was classified as Severity 1.';
  const w = windows(text, 'outage began at 02:14 UTC');
  assert.equal(w[0], 'outage began at 02:14 UTC', 'the cited span is checked first');
  assert.ok(w.includes('The incident was classified as Severity 1.'), 'every sentence is a candidate premise');
  assert.ok(w.some((x) => x.includes('failed.') && x.includes('02:14')), 'and so is every pair of neighbours');
});

test('a finding that has lost its evidence is never exported as a finding', async () => {
  const { token, project } = await seed('noevidence@test.local');
  const draft = await generate(token, project._id);
  const base = `/projects/${project._id}/drafts/${draft.id}`;
  const victim = claimsOf(draft).find((c) => c.status === 'supported');
  // simulate corruption / tampering: the stored status still says "supported" but the citations are gone
  await t.mongoose.connection.collection('drafts').updateOne(
    { _id: new t.mongoose.Types.ObjectId(draft.id) },
    { $set: { 'sections.$[].claims.$[c].evidence': [] } },
    { arrayFilters: [{ 'c.id': victim.id }] },
  );
  const exp = (await t.req('POST', `${base}/export`, { token, body: {} })).data;
  const { spec } = await pdfSpec(token, project._id, exp);
  assert.ok(!spec.sections.flatMap((s) => s.items).some((i) => i.text === victim.text), 'not printed');
  const manifest = JSON.parse(await (await t.req('GET', exp.manifestUrl.replace('/api', ''), { token })).res.text()).manifest;
  assert.ok(manifest.excluded.some((e) => e.id === victim.id && e.status === 'missing-evidence'));
  assert.ok(!manifest.claims.some((c) => c.id === victim.id));
  assert.ok(manifest.claims.filter((c) => ['supported', 'conflicted'].includes(c.status)).every((c) => c.evidence.length >= 1));
});

test('report: the same fact in other words is not written twice, but different facts are kept', () => {
  const { isNearDuplicate } = require('../services/draftGenerator');
  assert.ok(isNearDuplicate('Service was restored at 20:00 UTC.', 'Service was restored at 20:00 UTC by failing over to nova-cache-15.'));
  assert.ok(isNearDuplicate('At 20:28 UTC, the outage window ended.', 'The outage window ended at 20:28 UTC.'));
  assert.ok(!isNearDuplicate('The outage began at 02:14 UTC.', 'The outage ended at 02:14 UTC.'), 'began and ended are different facts');
  assert.ok(!isNearDuplicate('The outage began at 19:08 UTC.', 'The outage began at 19:09 UTC.'), 'different times are different facts');
  assert.ok(!isNearDuplicate('', 'anything'));
});

test('report: one passage worded twice for the same figures is a repeat, different events from it are not', () => {
  const { repeatsClaim } = require('../services/draftGenerator');
  const claim = (text, unit) => ({ text, evidence: [{ unitId: unit }] });
  assert.ok(repeatsClaim(claim('Roughly 9,800 customer sessions were interrupted.', 'u1'), claim('The incident affected customer sessions, with a total of 9,800 sessions being impacted.', 'u1')));
  assert.ok(!repeatsClaim(claim('Roughly 9,800 customer sessions were interrupted.', 'u1'), claim('The incident affected 9,800 sessions.', 'u2')), 'a different passage is kept as corroboration');
  assert.ok(!repeatsClaim(claim('The outage began at 19:08 UTC.', 'u3'), claim('Service was restored at 20:00 UTC.', 'u3')), 'different figures from one passage are different facts');
});
