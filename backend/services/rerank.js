const axios = require('axios');

const WORKER_URL = process.env.WORKER_URL || 'http://localhost:8000';
const ENABLED = process.env.RERANK !== '0';

/**
 * Cross-encoder relevance (0..1) of each text to the query, or null when the reranker is unavailable (retrieval then
 * simply keeps the embedding order). A failure never breaks a chat.
 */
async function rerankTexts(query, texts) {
  if (!ENABLED || !texts.length) return null;
  try {
    const { data } = await axios.post(`${WORKER_URL}/rerank`, { query, passages: texts }, { timeout: Number(process.env.RERANK_TIMEOUT_MS || 60000) });
    if (!data || !Array.isArray(data.scores) || data.scores.length !== texts.length || data.scores.some((s) => typeof s !== 'number')) return null;
    return data.scores;
  } catch (err) {
    console.warn('Reranker unavailable, keeping embedding order:', err.message);
    return null;
  }
}

module.exports = { rerankTexts };
