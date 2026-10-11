const axios = require('axios');

const WORKER_URL = process.env.WORKER_URL || 'http://localhost:8000';

/**
 * Generate embedding for a single text string via the Python worker's local model.
 */
async function embedText(text) {
  const response = await axios.post(`${WORKER_URL}/embed`, { text });
  return response.data.embedding;
}

module.exports = { embedText };
