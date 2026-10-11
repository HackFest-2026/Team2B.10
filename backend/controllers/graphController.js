const Document = require('../models/Document');
const Insight = require('../models/Insight');
const { record } = require('../services/audit');

const STOP_WORDS = new Set([
  'about', 'above', 'after', 'again', 'against', 'almost', 'along', 'also', 'although', 'always',
  'among', 'an', 'and', 'another', 'any', 'are', 'around', 'as', 'at', 'be', 'because', 'been',
  'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can', 'could', 'did', 'do', 'does',
  'doing', 'done', 'down', 'during', 'each', 'either', 'else', 'enough', 'especially', 'etc',
  'for', 'from', 'further', 'had', 'has', 'have', 'having', 'here', 'how', 'however', 'if', 'in',
  'into', 'is', 'it', 'its', 'itself', 'just', 'least', 'less', 'like', 'made', 'make', 'many',
  'may', 'might', 'more', 'most', 'much', 'must', 'near', 'need', 'neither', 'no', 'nor', 'not',
  'of', 'off', 'often', 'on', 'only', 'or', 'other', 'our', 'out', 'over', 'own', 'per', 'same',
  'several', 'should', 'since', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'them',
  'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too', 'toward', 'under',
  'until', 'up', 'upon', 'use', 'used', 'using', 'very', 'via', 'was', 'we', 'were', 'what',
  'when', 'where', 'which', 'while', 'who', 'why', 'will', 'with', 'within', 'without', 'would',
  'you', 'your', 'pdf', 'page', 'pages', 'document', 'insight', 'note', 'text'
]);

function normalizeToken(token) {
  const cleaned = token.toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!cleaned || cleaned.length < 4 || /^\d+$/.test(cleaned)) return null;
  if (STOP_WORDS.has(cleaned)) return null;
  if (cleaned.endsWith('s') && cleaned.length > 5) return cleaned.slice(0, -1);
  return cleaned;
}

function toDisplayLabel(token) {
  return token
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('-');
}

function extractCandidates(text = '') {
  const candidates = [];
  const phraseRegex = /\b([A-Z]{2,}(?:\s+[A-Z]{2,})?|[A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+){1,2})\b/g;
  let phraseMatch;
  while ((phraseMatch = phraseRegex.exec(text)) !== null) {
    const phrase = phraseMatch[1].trim().toLowerCase().replace(/\s+/g, '-');
    const normalized = normalizeToken(phrase);
    if (normalized) candidates.push(normalized);
  }

  const words = text.split(/\s+/);
  for (const word of words) {
    const normalized = normalizeToken(word);
    if (normalized) candidates.push(normalized);
  }

  return candidates;
}

const NEGATION_WORDS = new Set(['no', 'not', 'never', 'without', 'lack', 'lacks', 'limited', 'insufficient', 'cannot', 'fails', 'failed']);

function clamp(value, min, max) {
  const n = Number(value);
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function trimSentence(text = '', max = 240) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Extract 1-3 salient keywords from a text for compact graph labels.
 */
function shortLabel(text = '') {
  const words = String(text || '').replace(/[^a-zA-Z0-9\s-]/g, '').split(/\s+/).filter(Boolean);
  // Pick words that are meaningful (not stop words, >= 3 chars)
  const meaningful = words.filter((w) => {
    const lower = w.toLowerCase();
    return lower.length >= 3 && !STOP_WORDS.has(lower);
  });
  if (meaningful.length === 0) return words.slice(0, 2).join(' ') || '…';
  // Take up to 3 most significant words (first occurrences, capitalized words preferred)
  const picked = [];
  // Prefer capitalized / longer words first
  const sorted = [...meaningful].sort((a, b) => {
    const aUpper = a[0] === a[0].toUpperCase() ? 1 : 0;
    const bUpper = b[0] === b[0].toUpperCase() ? 1 : 0;
    if (bUpper !== aUpper) return bUpper - aUpper;
    return b.length - a.length;
  });
  const seen = new Set();
  for (const w of sorted) {
    const key = w.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(w);
    if (picked.length >= 3) break;
  }
  return picked.join(' ') || '…';
}

function tokenizeText(text = '') {
  return String(text || '')
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9-]/g, ''))
    .filter((w) => w && w.length > 2 && !STOP_WORDS.has(w));
}

function inferPolarity(text = '') {
  const tokens = tokenizeText(text);
  if (tokens.some((token) => NEGATION_WORDS.has(token))) return 'negative';
  return 'positive';
}

function buildTopicSignature(text = '') {
  const tokenCounts = new Map();
  for (const token of tokenizeText(text)) {
    tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1);
  }

  return Array.from(tokenCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([token]) => token)
    .sort();
}

function overlapCount(leftTokens = [], rightTokens = []) {
  if (!leftTokens.length || !rightTokens.length) return 0;
  const right = new Set(rightTokens);
  return leftTokens.reduce((count, token) => count + (right.has(token) ? 1 : 0), 0);
}

function jaccardSimilarity(leftTokens = [], rightTokens = []) {
  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  if (!left.size || !right.size) return 0;

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}

function computeSingleDocNodeTarget({ claims = [], explicitExpand = false }) {
  const safeMax = explicitExpand ? 24 : 15;
  if (!claims.length) return { target: 1, safeMax };

  const evidenceCounts = claims.map((claim) => claim.evidence.length);
  const avgEvidence = evidenceCounts.reduce((sum, n) => sum + n, 0) / evidenceCounts.length;
  const richEvidenceShare = evidenceCounts.filter((n) => n >= 2).length / evidenceCounts.length;

  let target = 11;
  const sparse = claims.length <= 3 || avgEvidence < 1;
  const verySparse = claims.length <= 2 || avgEvidence < 0.75;
  const dense = claims.length >= 6 && avgEvidence >= 1.7;
  const veryDense = claims.length >= 8 && avgEvidence >= 2.1 && richEvidenceShare >= 0.65;

  if (verySparse) target = 8;
  else if (sparse) target = 9;
  else if (veryDense) target = 14;
  else if (dense) target = 13;

  return { target: Math.min(target, safeMax), safeMax };
}

function distributeEvidenceBudget(claims, evidenceBudget, perClaimCap = 3) {
  const limits = new Map();
  claims.forEach((claim) => limits.set(claim.id, 0));

  let remaining = Math.max(0, evidenceBudget);
  if (remaining === 0 || claims.length === 0) return limits;

  for (const claim of claims) {
    if (remaining <= 0) break;
    if (claim.evidence.length > 0) {
      limits.set(claim.id, 1);
      remaining -= 1;
    }
  }

  let cursor = 0;
  while (remaining > 0 && claims.length > 0) {
    const claim = claims[cursor % claims.length];
    const current = limits.get(claim.id) || 0;
    const maxAllowed = Math.min(perClaimCap, claim.evidence.length);
    if (current < maxAllowed) {
      limits.set(claim.id, current + 1);
      remaining -= 1;
    }
    cursor += 1;
    if (cursor > claims.length * (perClaimCap + 2)) break;
  }

  return limits;
}

async function getProjectKnowledgeGraph(req, res) {
  try {
    const { projectId } = req.params;
    const question = String(req.query.question || '').trim();
    const maxClaims = clamp(req.query.maxClaims || 18, 6, 42);
    const explicitSingleDocExpand = String(req.query.expandSingleDoc || '').toLowerCase() === 'true' || maxClaims > 15;

    const project = req.project;
    await record(req.userId, 'GRAPH_READ', `project:${projectId}`);

    const documents = await Document.find({ projectId, status: 'DONE', classification: { $lte: req.clearance } })
      .select('_id filename createdAt')
      .sort({ createdAt: -1 })
      .lean();

    const documentIds = documents.map((doc) => doc._id);
    if (documentIds.length === 0) {
      return res.json({
        nodes: [],
        links: [],
        meta: {
          documentCount: 0,
          claimCount: 0,
          evidenceCount: 0,
          linkCount: 0,
          usedQuestion: question,
        },
      });
    }

    const insights = await Insight.find({ projectId, documentId: { $in: documentIds } })
      .select('documentId insightText text note highlights')
      .lean();

    const questionTokens = tokenizeText(question);
    const claims = [];

    for (const insight of insights) {
      const claimText = trimSentence(insight.insightText || insight.note || insight.text || '', 260);
      if (!claimText) continue;

      const claimTokens = tokenizeText(claimText);
      const highlightTexts = (insight.highlights || [])
        .map((highlight) => trimSentence(highlight.text || '', 180))
        .filter(Boolean)
        .slice(0, 3);

      if (!highlightTexts.length && insight.text) {
        highlightTexts.push(trimSentence(insight.text, 180));
      }

      claims.push({
        id: String(insight._id),
        documentId: String(insight.documentId),
        pageNumber: insight.pageNumber,
        text: claimText,
        tokens: claimTokens,
        topicTokens: buildTopicSignature(claimText),
        polarity: inferPolarity(claimText),
        evidence: highlightTexts,
      });
    }

    const rankedClaims = claims
      .map((claim) => {
        const questionOverlap = overlapCount(claim.tokens, questionTokens);
        const evidenceBoost = Math.min(2, claim.evidence.length * 0.5);
        return {
          ...claim,
          relevance: questionTokens.length ? (questionOverlap * 2) + evidenceBoost : evidenceBoost,
        };
      })
      .sort((a, b) => {
        if (b.relevance !== a.relevance) return b.relevance - a.relevance;
        return b.pageNumber - a.pageNumber;
      });

    const allDocumentIds = documents.map((doc) => String(doc._id));
    let selectedDocumentIds = new Set(allDocumentIds);
    let selectedClaims = [];

    if (allDocumentIds.length <= 1) {
      selectedClaims = rankedClaims.slice(0, maxClaims);
    } else {
      const claimsByDoc = new Map();
      for (const docId of allDocumentIds) claimsByDoc.set(docId, []);
      for (const claim of rankedClaims) {
        if (!claimsByDoc.has(claim.documentId)) claimsByDoc.set(claim.documentId, []);
        claimsByDoc.get(claim.documentId).push(claim);
      }

      const queues = Array.from(claimsByDoc.entries()).map(([docId, docClaims]) => ({
        docId,
        claims: docClaims,
        idx: 0,
      }));

      while (selectedClaims.length < maxClaims) {
        let pickedInRound = false;
        for (const queue of queues) {
          if (selectedClaims.length >= maxClaims) break;
          if (queue.idx >= queue.claims.length) continue;
          selectedClaims.push(queue.claims[queue.idx]);
          queue.idx += 1;
          pickedInRound = true;
        }
        if (!pickedInRound) break;
      }
    }

    const selectedClaimIds = new Set(selectedClaims.map((claim) => claim.id));
    const isSingleDocumentGraph = selectedDocumentIds.size === 1;

    let graphClaims = selectedClaims;
    let evidenceLimitByClaim = new Map();
    let singleDocNodeTarget = null;
    let singleDocSafeMax = null;

    if (isSingleDocumentGraph) {
      const budget = computeSingleDocNodeTarget({
        claims: selectedClaims,
        explicitExpand: explicitSingleDocExpand,
      });
      singleDocNodeTarget = budget.target;
      singleDocSafeMax = budget.safeMax;

      const claimBudget = singleDocNodeTarget <= 9 ? 3 : singleDocNodeTarget <= 12 ? 4 : 5;
      graphClaims = selectedClaims.slice(0, claimBudget);

      const evidenceBudget = Math.max(0, singleDocNodeTarget - 1 - graphClaims.length);
      evidenceLimitByClaim = distributeEvidenceBudget(graphClaims, evidenceBudget, singleDocNodeTarget >= 13 ? 3 : 2);
    }

    const nodes = [];
    const links = [];

    const docsById = new Map(documents.map((doc) => [String(doc._id), doc]));
    for (const docId of selectedDocumentIds) {
      const doc = docsById.get(docId);
      if (!doc) continue;
      nodes.push({
        id: `document:${docId}`,
        label: doc.filename,
        type: 'document',
        val: 8,
        createdAt: doc.createdAt,
      });
    }

    for (const claim of graphClaims) {
      const claimNodeId = `claim:${claim.id}`;
      nodes.push({
        id: claimNodeId,
        label: shortLabel(claim.text),
        fullText: claim.text,
        type: 'claim',
        polarity: claim.polarity,
        pageNumber: claim.pageNumber,
        val: 6,
      });

      links.push({
        source: `document:${claim.documentId}`,
        target: claimNodeId,
        type: 'mentions',
        weight: 1,
        explanation: {
          kind: 'document-claim',
          documentId: claim.documentId,
          claimText: claim.text,
          pageNumber: claim.pageNumber,
        },
      });

      const evidenceLimit = isSingleDocumentGraph
        ? (evidenceLimitByClaim.get(claim.id) || 0)
        : 2;

      claim.evidence.slice(0, evidenceLimit).forEach((snippet, idx) => {
        const evidenceNodeId = `evidence:${claim.id}:${idx}`;
        nodes.push({
          id: evidenceNodeId,
          label: shortLabel(snippet),
          fullText: snippet,
          type: 'evidence',
          val: 4,
        });

        links.push({
          source: evidenceNodeId,
          target: claimNodeId,
          type: 'supports',
          weight: 1,
          explanation: {
            kind: 'evidence-claim',
            snippet,
            claimText: claim.text,
            pageNumber: claim.pageNumber,
          },
        });
      });
    }

    const relationLinks = [];
    for (let i = 0; i < graphClaims.length; i += 1) {
      for (let j = i + 1; j < graphClaims.length; j += 1) {
        const left = graphClaims[i];
        const right = graphClaims[j];
        const topicalSimilarity = jaccardSimilarity(left.topicTokens, right.topicTokens);
        if (topicalSimilarity < 0.34) continue;

        const sameDocument = left.documentId === right.documentId;
        const relationType = left.polarity === right.polarity ? 'agrees' : 'contradicts';
        const baseWeight = relationType === 'contradicts' ? 1.25 : 1;

        relationLinks.push({
          source: `claim:${left.id}`,
          target: `claim:${right.id}`,
          type: relationType,
          weight: Number((baseWeight + topicalSimilarity).toFixed(2)),
          explanation: {
            kind: 'claim-claim',
            topicalSimilarity: Number(topicalSimilarity.toFixed(2)),
            sameDocument,
            leftPage: left.pageNumber,
            rightPage: right.pageNumber,
            leftClaim: left.text,
            rightClaim: right.text,
          },
        });
      }
    }

    relationLinks
      .sort((a, b) => b.weight - a.weight)
      .slice(0, isSingleDocumentGraph ? 2 : 28)
      .forEach((link) => links.push(link));

    const claimRelationMap = new Map();
    for (const link of links) {
      if (link.type !== 'agrees' && link.type !== 'contradicts') continue;
      const src = String(link.source);
      const tgt = String(link.target);
      claimRelationMap.set(src, claimRelationMap.get(src) || { agrees: 0, contradicts: 0 });
      claimRelationMap.set(tgt, claimRelationMap.get(tgt) || { agrees: 0, contradicts: 0 });
      claimRelationMap.get(src)[link.type] += 1;
      claimRelationMap.get(tgt)[link.type] += 1;
    }

    for (const node of nodes) {
      if (node.type !== 'claim') continue;
      const relation = claimRelationMap.get(node.id) || { agrees: 0, contradicts: 0 };
      node.consensusState = relation.contradicts > relation.agrees
        ? 'contested'
        : relation.agrees > 0
          ? 'supported'
          : 'isolated';
    }

    const cleanNodes = nodes.filter((node) => {
      if (node.type !== 'claim') return true;
      return selectedClaimIds.has(String(node.id).replace('claim:', ''));
    });

    const nodeIdSet = new Set(cleanNodes.map((node) => node.id));
    const cleanLinks = links.filter((link) => {
      const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
      const targetId = typeof link.target === 'object' ? link.target.id : link.target;
      return nodeIdSet.has(sourceId) && nodeIdSet.has(targetId);
    });

    res.json({
      nodes: cleanNodes,
      links: cleanLinks,
      meta: {
        documentCount: cleanNodes.filter((n) => n.type === 'document').length,
        claimCount: cleanNodes.filter((n) => n.type === 'claim').length,
        evidenceCount: cleanNodes.filter((n) => n.type === 'evidence').length,
        linkCount: cleanLinks.length,
        usedQuestion: question,
        hasQuestionFilter: question.length > 0,
        singleDocumentNodeTarget: isSingleDocumentGraph ? singleDocNodeTarget : null,
        singleDocumentSafeMax: isSingleDocumentGraph ? singleDocSafeMax : null,
        singleDocumentExpanded: isSingleDocumentGraph ? explicitSingleDocExpand : false,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getProjectKnowledgeGraph };