const axios = require('axios');
const { OLLAMA_URL, LLM_MODEL } = require('../config');

// Qwen3 emits <think>…</think> reasoning; we disable it per-request and strip any leftovers.
const stripThinking = (text) => text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

/**
 * Chat completion against the local Ollama server. Nothing leaves the host/network.
 * Pass { json: true } to constrain the output to valid JSON.
 */
async function chat(systemPrompt, userMessage, { json = false, temperature = 0.2 } = {}) {
  let response;
  try {
    response = await axios.post(
    `${OLLAMA_URL}/api/chat`,
    {
      model: LLM_MODEL,
      stream: false,
      think: false,
      ...(json ? { format: 'json' } : {}),
      options: { temperature, num_ctx: Number(process.env.LLM_NUM_CTX || 8192) },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    },
    { timeout: Number(process.env.LLM_TIMEOUT_MS || 300000) }
    );
  } catch (err) {
    // axios reports a refused connection as an empty AggregateError; say what actually went wrong
    if (err.code === 'ECONNABORTED') throw new Error(`The language model at ${OLLAMA_URL} took too long to answer`);
    if (!err.response) throw new Error(`Cannot reach the language model at ${OLLAMA_URL}: ${err.code || err.message || 'connection failed'}`);
    throw err;
  }

  return stripThinking(response.data.message.content);
}

module.exports = { chat };
