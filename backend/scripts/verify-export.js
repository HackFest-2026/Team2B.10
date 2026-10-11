// Offline verification of a signed export: node scripts/verify-export.js <manifest.json> <public-key.pem> [document.pdf]
// Checks the signature and the PDF hash only; it needs no database and no access to the sources, so a recipient
// can run it anywhere. (Source-level checks are done by POST /api/verify inside the deployment.)
const crypto = require('crypto');
const fs = require('fs');

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).filter((k) => value[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const [manifestPath, keyPath, pdfPath] = process.argv.slice(2);
if (!manifestPath || !keyPath) { console.error('Usage: node scripts/verify-export.js <manifest.json> <public-key.pem> [document.pdf]'); process.exit(2); }

const { manifest, signature } = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const publicKey = crypto.createPublicKey(fs.readFileSync(keyPath));
const signatureOk = crypto.verify(null, Buffer.from(canonical(manifest)), publicKey, Buffer.from(signature.value, 'base64'));
console.log(`${signatureOk ? 'OK  ' : 'FAIL'} signature ${signatureOk ? 'matches' : 'does NOT match'} the manifest (key ${signature.keyId})`);
let ok = signatureOk;
if (pdfPath) {
  const same = crypto.createHash('sha256').update(fs.readFileSync(pdfPath)).digest('hex') === manifest.pdf.sha256;
  console.log(`${same ? 'OK  ' : 'FAIL'} PDF ${same ? 'matches' : 'does NOT match'} the manifest`);
  ok = ok && same;
}
console.log(ok ? `VALID: ${manifest.claims.length} statements, ${manifest.sources.length} sources, classification ${manifest.classificationName}` : 'INVALID');
process.exit(ok ? 0 : 1);
