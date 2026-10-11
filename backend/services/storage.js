const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { STORAGE_DIR } = require('../config');

fs.mkdirSync(STORAGE_DIR, { recursive: true });

// Keys are server-generated, never user-supplied, so they cannot traverse directories.
const KEY_RE = /^[a-f0-9]{32}\.[a-z0-9]{1,8}$/;

function isValidKey(key) {
  return KEY_RE.test(key || '');
}

function pathFor(key) {
  if (!isValidKey(key)) throw new Error('Invalid storage key');
  return path.join(STORAGE_DIR, key);
}

async function put(buffer, originalName) {
  const ext = (path.extname(originalName || '').slice(1).toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin').slice(0, 8);
  const key = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  await fs.promises.writeFile(pathFor(key), buffer, { flag: 'wx' });
  return { key, sha256: crypto.createHash('sha256').update(buffer).digest('hex'), size: buffer.length };
}

function keyFromUrl(fileUrl) {
  const m = /^\/api\/files\/([^/?#]+)$/.exec(fileUrl || '');
  return m && isValidKey(m[1]) ? m[1] : null;
}

const urlFor = (key) => `/api/files/${key}`;

async function exists(key) {
  try {
    await fs.promises.access(pathFor(key));
    return true;
  } catch {
    return false;
  }
}

async function sha256(key) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(pathFor(key))) hash.update(chunk);
  return hash.digest('hex');
}

/** Deletes a stored file. Missing files are fine: deleting must be idempotent. */
async function remove(key) {
  if (!isValidKey(key)) return false;
  try {
    await fs.promises.unlink(pathFor(key));
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

module.exports = { remove, sha256, put, pathFor, exists, isValidKey, keyFromUrl, urlFor };
