const axios = require('axios');

const WORKER_URL = process.env.WORKER_URL || 'http://localhost:8000';
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 3000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function triggerProcessing({ documentId, projectId, storageKey, filename, sourceType }) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await axios.post(`${WORKER_URL}/process`, {
        documentId,
        projectId,
        storageKey,
        filename,
        sourceType,
      }, { timeout: Number(process.env.WORKER_TIMEOUT_MS || 1800000) });
      return response.data;
    } catch (err) {
      lastError = err;
      const isConnectionError =
        err.code === 'ECONNREFUSED' ||
        err.code === 'ECONNRESET' ||
        err.code === 'ETIMEDOUT' ||
        (err.response && err.response.status >= 500);
      if (isConnectionError && attempt < MAX_RETRIES) {
        console.warn(`Worker attempt ${attempt} failed (${err.code || err.message}), retrying in ${RETRY_DELAY_MS}ms...`);
        await sleep(RETRY_DELAY_MS);
      } else {
        // Surface the worker's own explanation (e.g. "File is empty") instead of "status code 422".
        const detail = err.response && err.response.data && err.response.data.detail;
        if (detail) throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
        throw err;
      }
    }
  }
  throw lastError;
}

module.exports = { triggerProcessing };
