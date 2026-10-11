// Deterministic claim verification. A claim is only accepted when each piece of evidence it cites
// points at a unit that was actually supplied and quotes that unit verbatim. A model cannot
// fabricate a citation that passes this check. (Entailment/NLI is layered on in phase 4.)
const MIN_QUOTE_CHARS = 5;
const MAX_QUOTE_CHARS = 400;
const MAX_EVIDENCE_PER_CLAIM = 3;

const normalize = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

// "foo … bar" is allowed: every fragment must occur, in order.
function quoteInText(quote, text) {
  const haystack = normalize(text);
  const fragments = normalize(quote).split(/…|\.\.\./).map((f) => f.trim()).filter(Boolean);
  if (!fragments.length) return false;
  let from = 0;
  for (const fragment of fragments) {
    const at = haystack.indexOf(fragment, from);
    if (at === -1) return false;
    from = at + fragment.length;
  }
  return true;
}

/**
 * @param rawClaims  model output: [{claim, evidence: [{unit, quote}]}]
 * @param units      the exact units shown to the model, in prompt order (unit numbers are 1-based indexes)
 * @returns {verified: [{claim, evidence: [{unit, unitId, quote}]}], rejected: [{claim, reason}]}
 */
function verifyClaims(rawClaims, units) {
  const verified = [];
  const rejected = [];
  if (!Array.isArray(rawClaims)) return { verified, rejected: [{ claim: '', reason: 'claims is not a list' }] };

  for (const raw of rawClaims) {
    const claim = raw && typeof raw.claim === 'string' ? raw.claim.trim() : '';
    if (!claim) { rejected.push({ claim: '', reason: 'empty claim' }); continue; }
    if (!Array.isArray(raw.evidence) || raw.evidence.length === 0) { rejected.push({ claim, reason: 'no evidence cited' }); continue; }

    const good = [];
    const problems = [];
    for (const ev of raw.evidence.slice(0, MAX_EVIDENCE_PER_CLAIM)) {
      const n = Number(ev && ev.unit);
      const unit = Number.isInteger(n) ? units[n - 1] : undefined;
      const quote = ev && typeof ev.quote === 'string' ? ev.quote.trim() : '';
      if (!unit) problems.push(`unit ${ev && ev.unit} was not provided`);
      else if (quote.length < MIN_QUOTE_CHARS || quote.length > MAX_QUOTE_CHARS) problems.push(`quote for unit ${n} must be ${MIN_QUOTE_CHARS}-${MAX_QUOTE_CHARS} characters`);
      else if (!quoteInText(quote, unit.text)) problems.push(`quote for unit ${n} is not a verbatim excerpt of it`);
      else if (!good.some((g) => g.unit === n && g.quote === quote)) good.push({ unit: n, unitId: String(unit._id), quote });
    }
    if (good.length) verified.push({ claim, evidence: good });
    else rejected.push({ claim, reason: problems.join('; ') });
  }
  return { verified, rejected };
}

module.exports = { verifyClaims, quoteInText, normalize };
