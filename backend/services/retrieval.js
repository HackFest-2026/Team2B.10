const EvidenceUnit = require('../models/EvidenceUnit');
const Document = require('../models/Document');
const { MAX_CLASSIFICATION } = require('../sourceTypes');
const { cosineSimilarity } = require('../utils/similarity');
const { rerankTexts } = require('./rerank');

const STOPWORDS = new Set(['the', 'and', 'for', 'was', 'were', 'what', 'when', 'where', 'who', 'how', 'why', 'did', 'does', 'with', 'that', 'this', 'from', 'are', 'has', 'have', 'had', 'there', 'their', 'about', 'into', 'than', 'then', 'which', 'would', 'could', 'should']);
const LEXICAL_WEIGHT = 0.3;
// In prose documents (papers, reports) a figure label, a heading or a table cell that merely repeats a query word
// ("BERT BERT") matches as well as the paragraph that actually explains it. Logs and chats are short by nature, so
// the correction applies to documents only.
const PROSE_TYPES = new Set(['report', 'scan']);
const proseBias = (text, type) => {
  if (!PROSE_TYPES.has(type)) return 0;
  if (text.length < 40) return -0.3;
  if (text.length < 80) return -0.12;
  return text.length >= 150 ? 0.06 : 0;
};
// Title, authors and affiliations sit in the first few units of a document and read as bare names, so
// "who wrote this?" matches them poorly (a cited reference list matches better). For such questions
// the opening units get a boost.
const FRONT_MATTER_UNITS = 16;
const FRONT_MATTER_BOOST = 0.6;
const FRONT_MATTER_QUESTION = /\b(abstract|authors?|author's|wrote|written|writers?|title[ds]?|titled|affiliations?|institutions?|published|publication|contributors?|who (?:made|created|are the people))\b/i;
const asksAboutFrontMatter = (text = '') => FRONT_MATTER_QUESTION.test(text);

// Identifiers like EV-9001, atlas-db-02 or 10.0.4.17 are poorly captured by embeddings,
// so the final score blends cosine similarity with exact-token overlap.
function queryTokens(text = '') {
  const tokens = text.toLowerCase().match(/[a-z0-9][a-z0-9._:-]*[a-z0-9]|[a-z0-9]/g) || [];
  return [...new Set(tokens.filter((t) => t.length >= 3 && !STOPWORDS.has(t)))];
}

function lexicalScore(tokens, text) {
  if (!tokens.length) return 0;
  const haystack = text.toLowerCase();
  return tokens.filter((t) => haystack.includes(t)).length / tokens.length;
}

/**
 * The only way application code reads evidence for retrieval. The clearance filter is part of
 * the database query, so units above the caller's level are never loaded, scored, or returned —
 * and therefore can never reach a prompt.
 */
async function retrieveUnits({ projectId, clearance, queryEmbedding, queryText = '', documentId, documentIds, k = 8 }) {
  const frontMatter = asksAboutFrontMatter(queryText);
  if (frontMatter) k = Math.max(k, FRONT_MATTER_UNITS);
  if (!Number.isInteger(clearance) || clearance < 0 || clearance > MAX_CLASSIFICATION) {
    throw new Error('retrieveUnits requires a valid clearance');
  }
  const filter = { projectId, classification: { $lte: clearance } };
  if (documentId) filter.documentId = documentId;
  else if (documentIds) filter.documentId = { $in: documentIds };

  const candidates = await EvidenceUnit.find(filter).select('+embedding').lean();
  const tokens = queryTokens(queryText);
  const docs = await Document.find({ _id: { $in: [...new Set(candidates.map((u) => String(u.documentId)))] } }).select('filename sourceType').lean();
  const byId = new Map(docs.map((d) => [String(d._id), d]));

  const RERANK_POOL = 40;
  const pool = candidates
    .map((u) => {
      const type = byId.get(String(u.documentId))?.sourceType;
      const score = cosineSimilarity(queryEmbedding, u.embedding) + LEXICAL_WEIGHT * lexicalScore(tokens, u.text) + (frontMatter && u.ordinal <= FRONT_MATTER_UNITS ? FRONT_MATTER_BOOST : 0) + proseBias(u.text, type);
      return { ...u, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(k, RERANK_POOL));

  // The embedding order is a cheap first pass over everything; a cross-encoder then reads the question together with
  // each of the best candidates and decides which ones actually answer it.
  const rerank = await rerankTexts(queryText, pool.map((u) => u.text));
  if (rerank) pool.forEach((u, i) => { u.rerank = rerank[i]; });
  const top = (rerank ? [...pool].sort((a, b) => b.rerank - a.rerank || b.score - a.score) : pool)
    .slice(0, k)
    .map(({ embedding, ...unit }) => unit);

  return top.map((u) => ({ ...u, filename: byId.get(String(u.documentId))?.filename || 'unknown', sourceType: byId.get(String(u.documentId))?.sourceType }));
}

const OVERVIEW_MAX_UNITS = 36;
const OVERVIEW_MAX_DOCS = 8;
const OVERVIEW_OPENING_UNITS = 40;   // where the abstract and introduction live

/**
 * Passages for questions about the whole collection ("explain the project", "what do these papers have in common",
 * "who are the authors"). Plain similarity search finds the few passages closest to the question, which for a broad
 * question are arbitrary; this takes a share from *every* document instead:
 *   mode 'front'    the opening passages (title, authors, affiliations, abstract) of each document
 *   mode 'overview' each document's best-matching opening passages plus its best matches anywhere
 * Clearance is part of the database queries, as in retrieveUnits.
 */
async function retrieveOverview({ projectId, clearance, documentIds, queryEmbedding, queryText = '', mode = 'overview' }) {
  if (!Number.isInteger(clearance) || clearance < 0 || clearance > MAX_CLASSIFICATION) {
    throw new Error('retrieveOverview requires a valid clearance');
  }
  const docFilter = { projectId, status: 'DONE', classification: { $lte: clearance } };
  if (documentIds && documentIds.length) docFilter._id = { $in: documentIds };
  const docs = await Document.find(docFilter).select('filename sourceType').sort({ createdAt: 1 }).limit(OVERVIEW_MAX_DOCS).lean();
  if (!docs.length) return [];

  const perDoc = Math.max(4, Math.floor(OVERVIEW_MAX_UNITS / docs.length));
  const tokens = queryTokens(queryText);
  const out = [];
  for (const doc of docs) {
    const units = await EvidenceUnit.find({ projectId, documentId: doc._id, classification: { $lte: clearance } }).select('+embedding').sort({ ordinal: 1 }).lean();
    // Substantive paragraphs (abstract, introduction, conclusion) answer broad questions; author lines, headings and table cells do not.
    const substance = (u) => (u.text.length >= 160 ? 0.35 : u.text.length < 60 ? -0.35 : 0);
    const scored = units.map((u) => ({ ...u, score: cosineSimilarity(queryEmbedding, u.embedding) + LEXICAL_WEIGHT * lexicalScore(tokens, u.text) + (mode === 'overview' ? substance(u) : 0) }));
    let chosen;
    if (mode === 'front') {
      chosen = scored.slice(0, Math.min(perDoc, FRONT_MATTER_UNITS));
    } else {
      const byScore = (list) => [...list].sort((a, b) => b.score - a.score);
      const opening = byScore(scored.filter((u) => u.ordinal <= OVERVIEW_OPENING_UNITS)).slice(0, Math.ceil(perDoc / 2));
      const taken = new Set(opening.map((u) => String(u._id)));
      const rest = byScore(scored.filter((u) => !taken.has(String(u._id)))).slice(0, perDoc - opening.length);
      chosen = [...opening, ...rest];
    }
    chosen.sort((a, b) => a.ordinal - b.ordinal);
    out.push(...chosen.map(({ embedding, ...unit }) => ({ ...unit, filename: doc.filename, sourceType: doc.sourceType })));
  }
  return out;
}

module.exports = { retrieveUnits, retrieveOverview, queryTokens, asksAboutFrontMatter };
