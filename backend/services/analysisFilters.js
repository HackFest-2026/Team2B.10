// Which units are worth a language-model call during analysis. Pattern-based mentions (hosts, IPs, IDs, emails) are
// always extracted for every unit; these filters only decide who reaches the slow, model-based steps. Deciding
// this in code keeps a 500-unit paper from costing hundreds of model calls on a laptop.

const CITATION = /\[\d+(?:\s*[,–-]\s*\d+)*\]/g;
// bibliography entries: authors, venue, year. Their numbers are volumes and years, not claims.
const REFERENCE = /(arXiv preprint|\bIn Proceedings|Proceedings of|\bpp\. ?\d|et al\.,? \(?(?:19|20)\d{2}|(?:19|20)\d{2}\)?\.\s*$|Association for Computational|Journal of|Conference on|Transactions on)/i;
// two capitalised words ("Google Brain", "Aisha Petrov"), CamelCase / acronyms ("BERT", "SQuAD", "atlas-db-02" is a pattern, not a name)
const NAME = /\b[A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+\b|\b[A-Z][A-Za-z]*[A-Z][A-Za-z0-9-]*\b|\b[A-Z]{2,}[A-Za-z0-9-]*\b/;

// Statements that are comparable without a number: who owns or did something, why it happened, how bad it was.
const NAMED_CLAIM = /\b(root cause|caused by|cause[sd]?|responsible|owner|owns?|assigned|restored|resolved|recovered|severity|status|incident|outage|failure|failed|approved|signed off|led by|reported by|declared)\b/i;

const MIN_CHARS = 30;

/** A sentence that could state a comparable value: a number that is not just a citation marker, or an ownership/cause/status statement. */
function worthFacts(text = '') {
  if (text.length < MIN_CHARS || REFERENCE.test(text)) return false;
  return /\d/.test(text.replace(CITATION, '')) || NAMED_CLAIM.test(text);
}

/** A sentence that could name a person, organisation, place or system (beyond the first word of the sentence). */
function worthEntities(text = '') {
  return text.length >= MIN_CHARS && NAME.test(text.slice(1));
}

const SMALL_DOCUMENT_UNITS = 60;

/**
 * Applies a worthiness test only to large documents (papers, manuals). Short sources such as an incident report,
 * a chat or a notice are read in full: every line of them can matter and they are cheap.
 */
function selectWorthy(units, isWorthy) {
  const counts = new Map();
  for (const u of units) counts.set(String(u.documentId), (counts.get(String(u.documentId)) || 0) + 1);
  return units.filter((u) => counts.get(String(u.documentId)) <= SMALL_DOCUMENT_UNITS || isWorthy(u.text));
}

/** Round-robin across documents so one long document cannot use a run's whole budget. */
function interleaveByDocument(units) {
  const queues = new Map();
  for (const u of units) {
    const key = String(u.documentId);
    if (!queues.has(key)) queues.set(key, []);
    queues.get(key).push(u);
  }
  const lists = [...queues.values()];
  const out = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

module.exports = { worthFacts, worthEntities, interleaveByDocument, selectWorthy, SMALL_DOCUMENT_UNITS };
