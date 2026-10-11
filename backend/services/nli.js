const axios = require('axios');

const WORKER_URL = process.env.WORKER_URL || 'http://localhost:8000';
const ENTAIL_MIN = Number(process.env.NLI_ENTAIL_MIN || 0.5);

class NliUnavailable extends Error {}

/** @returns [{entailment, contradiction, neutral}] aligned with `pairs` ([{premise, hypothesis}]) */
async function entailmentScores(pairs) {
  if (!pairs.length) return [];
  let data;
  try {
    ({ data } = await axios.post(`${WORKER_URL}/nli`, { pairs }, { timeout: Number(process.env.NLI_TIMEOUT_MS || 120000) }));
  } catch (err) {
    throw new NliUnavailable(`entailment model unavailable: ${err.message}`);
  }
  if (!data || !Array.isArray(data.results) || data.results.length !== pairs.length) throw new NliUnavailable('entailment model returned an unusable response');
  return data.results;
}

// NLI models read a sentence or two far more reliably than a long paragraph (the same sentence that scores 0.996
// alone can score 0.001 buried in a three-sentence premise). So a claim is checked against the quoted span and
// against each sentence and pair of adjacent sentences of the cited passage, and the best window counts.
const MAX_WINDOWS = 12;
function windows(text, quote) {
  const sentences = text.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter((x) => x.length >= 8);
  const out = [];
  if (quote) out.push(quote);
  sentences.forEach((x, i) => { out.push(x); if (sentences[i + 1]) out.push(`${x} ${sentences[i + 1]}`); });
  if (!out.length) out.push(text);
  return [...new Set(out)].slice(0, MAX_WINDOWS);
}

/**
 * Does the claim follow from at least one of its cited passages?
 * @param evidence [{text, quote?}]  the full passage and the span the claim cites
 * @returns {entailment, contradiction, supported}
 */
async function checkClaim(claimText, evidence) {
  const pairs = evidence.flatMap((e) => windows(e.text, e.quote).map((premise) => ({ premise, hypothesis: claimText })));
  const scores = await entailmentScores(pairs);
  const entailment = Math.max(0, ...scores.map((s) => s.entailment || 0));
  const contradiction = Math.max(0, ...scores.map((s) => s.contradiction || 0));
  return { entailment, contradiction, supported: entailment >= ENTAIL_MIN };
}

module.exports = { checkClaim, entailmentScores, windows, NliUnavailable, ENTAIL_MIN };
