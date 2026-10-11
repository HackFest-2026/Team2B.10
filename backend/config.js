const path = require('path');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  console.error('❌ JWT_SECRET must be set (at least 16 characters). See .env.example.');
  process.exit(1);
}

module.exports = {
  JWT_SECRET: process.env.JWT_SECRET,
  STORAGE_DIR: path.resolve(process.env.STORAGE_DIR || path.join(__dirname, '..', 'storage')),
  SIGNING_KEY_DIR: path.resolve(process.env.SIGNING_KEY_DIR || path.join(__dirname, '..', 'keys')),
  OLLAMA_URL: (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, ''),
  LLM_MODEL: process.env.LLM_MODEL || 'qwen3:14b',
  MAX_UPLOAD_BYTES: Number(process.env.MAX_UPLOAD_MB || 50) * 1024 * 1024,
};
