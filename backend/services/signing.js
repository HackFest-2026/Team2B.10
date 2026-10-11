// Local Ed25519 signing for provenance manifests. The private key never leaves SIGNING_KEY_DIR (a separate
// volume in docker, not the one the worker can read); public keys are kept so older manifests still verify.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { SIGNING_KEY_DIR } = require('../config');

const PRIVATE = path.join(SIGNING_KEY_DIR, 'signing-key.pem');
let cached;

const keyIdOf = (publicKey) => crypto.createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);

function load() {
  if (cached) return cached;
  fs.mkdirSync(SIGNING_KEY_DIR, { recursive: true, mode: 0o700 });
  let privateKey;
  if (fs.existsSync(PRIVATE)) {
    privateKey = crypto.createPrivateKey(fs.readFileSync(PRIVATE));
  } else {
    ({ privateKey } = crypto.generateKeyPairSync('ed25519'));
    fs.writeFileSync(PRIVATE, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  }
  const publicKey = crypto.createPublicKey(privateKey);
  const keyId = keyIdOf(publicKey);
  fs.writeFileSync(path.join(SIGNING_KEY_DIR, `${keyId}.pub.pem`), publicKey.export({ type: 'spki', format: 'pem' }));
  cached = { privateKey, publicKey, keyId };
  return cached;
}

// Deterministic JSON: sorted keys, no whitespace. Signing and verifying must see byte-identical text.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).filter((k) => value[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sign(manifest) {
  const { privateKey, keyId } = load();
  return { alg: 'ed25519', keyId, value: crypto.sign(null, Buffer.from(canonical(manifest)), privateKey).toString('base64') };
}

/** @returns {ok: boolean, reason?: string} */
function verify(manifest, signature) {
  if (!signature || signature.alg !== 'ed25519' || typeof signature.value !== 'string' || !/^[a-f0-9]{16}$/.test(signature.keyId || '')) {
    return { ok: false, reason: 'malformed signature block' };
  }
  const keyFile = path.join(SIGNING_KEY_DIR, `${signature.keyId}.pub.pem`);
  load();
  if (!fs.existsSync(keyFile)) return { ok: false, reason: `unknown signing key ${signature.keyId}` };
  const publicKey = crypto.createPublicKey(fs.readFileSync(keyFile));
  const ok = crypto.verify(null, Buffer.from(canonical(manifest)), publicKey, Buffer.from(signature.value, 'base64'));
  return ok ? { ok: true } : { ok: false, reason: 'signature does not match the manifest contents' };
}

const publicKeyPem = () => load().publicKey.export({ type: 'spki', format: 'pem' });
const keyId = () => load().keyId;

module.exports = { sign, verify, canonical, publicKeyPem, keyId };
