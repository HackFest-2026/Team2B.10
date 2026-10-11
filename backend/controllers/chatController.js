const Document = require('../models/Document');
const EvidenceUnit = require('../models/EvidenceUnit');
const { embedText } = require('../services/embedding');
const { chat } = require('../services/llm');
const { retrieveUnits, retrieveOverview, asksAboutFrontMatter } = require('../services/retrieval');
const { record } = require('../services/audit');
const { classifyIntent, greetingReply, projectInfoReply, GENERAL_SYSTEM } = require('../services/chatIntent');
const { cleanHistory, condenseQuestion, buildPassages, passagesFromUnits, capPassages, answerFromPassages, formatHistory } = require('../services/rag');

const RETRIEVE_K = 8;
// Retrieval always returns the k nearest units, relevant or not. Measured on a real paper, on-topic questions
// score 0.75 or more and chit-chat or off-topic ones 0.52 or less, so a weak best match means the sources have
// nothing to say and the question is answered as a general one.
const MIN_RELEVANCE = Number(process.env.CHAT_MIN_RELEVANCE || 0.6);
// With the cross-encoder reranker the verdict is its own: an irrelevant question scores ~0.000 against every passage
// of a real paper, a relevant one 0.9 or more.
const MIN_RERANK = Number(process.env.CHAT_MIN_RERANK || 0.05);
const NO_ANSWER = 'The sources you are authorized to read do not contain enough information to answer that.';

const describeScopeLabel = (scope) => (scope.documents.length === 1 ? scope.documents[0].filename : `the ${scope.documents.length} selected documents`);
const scopeMeta = (scope) => ({ type: scope.type, documentIds: scope.documents.map((d) => d.id) });

// POST /api/projects/:projectId/chat   { message, history?, documentIds?, context? }
async function chatWithProject(req, res) {
  try {
    const { projectId } = req.params;
    const body = typeof req.body === 'string' ? { message: req.body } : req.body || {};
    const question = String(body.message || body.question || '').trim();
    const selected = String(body.context || '').slice(0, 2000);
    const history = cleanHistory(body.history);
    const { documentId, imageBase64 } = body;

    if (!question) return res.status(400).json({ error: 'message is required' });
    // Image questions need a hosted vision model, which the on-prem deployment does not use.
    if (imageBase64) return res.status(501).json({ error: 'Image questions are disabled in on-prem mode' });

    // Scope: none = whole project; otherwise every named document must belong to this project, be fully
    // processed and be within the caller's clearance. Checked before any retrieval or model call.
    const requested = [...new Set([...(Array.isArray(body.documentIds) ? body.documentIds : []), ...(documentId ? [documentId] : [])].map(String))];
    let scopeDocs = [];
    if (requested.length > 0) {
      const valid = requested.every((id) => /^[a-f0-9]{24}$/i.test(id));
      scopeDocs = valid
        ? await Document.find({ _id: { $in: requested }, projectId, status: 'DONE', classification: { $lte: req.clearance } }).select('_id filename').lean()
        : [];
      if (scopeDocs.length !== requested.length) {
        await record(req.userId, 'ACCESS_DENIED', `project:${projectId}`, { action: 'chat', documentIds: requested });
        return res.status(404).json({ error: 'Document not found' });
      }
    }
    const scope = {
      type: scopeDocs.length === 0 ? 'project' : scopeDocs.length === 1 ? 'document' : 'documents',
      documents: scopeDocs.map((d) => ({ id: String(d._id), filename: d.filename })),
    };

    // Greetings and questions about the project itself need no retrieval and no model.
    const intent = selected ? 'question' : classifyIntent(question);
    if (intent === 'greeting' || intent === 'meta') {
      let answer = greetingReply(question, req.project.name);
      if (intent === 'meta') {
        const docFilter = { projectId, status: 'DONE', classification: { $lte: req.clearance }, ...(scopeDocs.length ? { _id: { $in: scopeDocs.map((d) => d._id) } } : {}) };
        const docs = await Document.find(docFilter).select('filename sourceType pageCount').sort({ filename: 1 }).lean();
        const counts = new Map((await EvidenceUnit.aggregate([
          { $match: { projectId: req.project._id, documentId: { $in: docs.map((d) => d._id) }, classification: { $lte: req.clearance } } },
          { $group: { _id: '$documentId', n: { $sum: 1 } } },
        ])).map((r) => [String(r._id), r.n]));
        answer = projectInfoReply(question, docs.map((d) => ({ ...d, units: counts.get(String(d._id)) || 0 })), req.project.name, scope.type === 'project' ? 'in this project' : describeScopeLabel(scope));
      }
      const mode = intent === 'greeting' ? 'smalltalk' : 'project-info';
      await record(req.userId, 'CHAT_QUERY', `project:${projectId}`, { scope: scopeMeta(scope), mode, modelCalled: false, clearance: req.clearance, retrieved: [], cited: [] });
      return res.json({ scope, mode, modelCalled: false, answer, sources: [], classification: 0, verification: { verified: 0, rejected: 0, entailmentChecked: false }, grounding: { checked: false, confirmed: 0, unconfirmed: 0 } });
    }

    // A follow-up ("and what about its results?") is rewritten into a question that stands on its own, using the
    // conversation, so retrieval does not have to guess what "its" means.
    const standalone = selected ? question : await condenseQuestion(question, history);
    const searchIntent = selected ? 'question' : classifyIntent(standalone);

    // Retrieval is clearance-filtered inside the query: nothing above the caller's level is ever loaded.
    const queryText = selected ? `${standalone} ${selected}` : standalone;
    const frontMatter = !selected && asksAboutFrontMatter(standalone);
    const wholeCollection = !selected && (searchIntent === 'overview' || frontMatter);
    // A broad question says nothing about content, so aim the search at what summarises a document.
    const overviewAim = `${queryText}. Abstract: the main idea, contribution, method and key results of the document.`;
    const queryEmbedding = await embedText(wholeCollection && !frontMatter ? overviewAim : queryText);
    const scopeIds = scopeDocs.length ? scopeDocs.map((d) => d._id) : undefined;

    let units;
    let passages;
    if (wholeCollection) {
      // broad questions and "who are the authors" need a share of every document, not the few nearest passages
      units = await retrieveOverview({ projectId: req.project._id, clearance: req.clearance, documentIds: scopeIds, queryEmbedding, queryText, mode: frontMatter ? 'front' : 'overview' });
      passages = capPassages(passagesFromUnits(units), 12);
    } else {
      units = await retrieveUnits({ projectId: req.project._id, clearance: req.clearance, queryEmbedding, queryText, documentIds: scopeIds, k: RETRIEVE_K });
      passages = await buildPassages(units, { clearance: req.clearance });
    }
    const reranked = units.length > 0 && units.every((u) => typeof u.rerank === 'number');
    const relevant = units.length > 0 && (wholeCollection || (reranked ? Math.max(...units.map((u) => u.rerank)) >= MIN_RERANK : Math.max(...units.map((u) => u.score)) >= MIN_RELEVANCE));
    const retrievedIds = passages.flatMap((p) => p.unitIds.map(String));

    // Nothing in the selected sources relates to the question: answer as a general assistant, clearly labelled.
    if (!relevant && !selected) {
      let general = '';
      try {
        const convo = history.length ? `Conversation so far:\n${formatHistory(history)}\n\nQuestion: ` : '';
        general = await chat(GENERAL_SYSTEM, `${convo}${standalone}`, { temperature: 0.3 });
      } catch (err) {
        console.warn('General answer unavailable:', err.message);
      }
      await record(req.userId, 'CHAT_QUERY', `project:${projectId}`, { scope: scopeMeta(scope), mode: general ? 'general' : 'no-answer', modelCalled: !!general, clearance: req.clearance, retrieved: retrievedIds, cited: [] });
      return res.json({ scope, mode: general ? 'general' : 'documents', modelCalled: !!general, answer: general || NO_ANSWER, sources: [], classification: 0, verification: { verified: 0, rejected: 0, entailmentChecked: false }, grounding: { checked: false, confirmed: 0, unconfirmed: 0 } });
    }

    if (!passages.length || !relevant) {
      await record(req.userId, 'CHAT_QUERY', `project:${projectId}`, { scope: scopeMeta(scope), mode: 'documents', modelCalled: false, clearance: req.clearance, retrieved: [], cited: [] });
      return res.json({ scope, mode: 'documents', modelCalled: false, answer: NO_ANSWER, sources: [], classification: 0, verification: { verified: 0, rejected: 0, entailmentChecked: false }, grounding: { checked: false, confirmed: 0, unconfirmed: 0 } });
    }

    const { answer, sources, grounding } = await answerFromPassages({ question: standalone, history, passages, selected, overview: wholeCollection && !frontMatter });
    // A reply that cites nothing is the model saying the passages do not answer the question.
    const answered = sources.length > 0;

    await record(req.userId, 'CHAT_QUERY', `project:${projectId}`, {
      scope: scopeMeta(scope),
      clearance: req.clearance,
      modelCalled: true,
      rewritten: standalone !== question,
      retrieved: retrievedIds,
      cited: sources.flatMap((s) => s.unitIds.map(String)),
      confirmedSentences: grounding.confirmed,
      unconfirmedSentences: grounding.unconfirmed,
    });

    res.json({
      scope,
      mode: 'documents',
      modelCalled: true,
      ...(standalone !== question ? { rewritten: standalone } : {}),
      answer,
      sources,
      classification: sources.reduce((max, s) => Math.max(max, s.classification), 0),
      grounding,
      // kept for older clients: how many cited sentences were confirmed
      verification: { verified: grounding.confirmed, rejected: 0, entailmentChecked: grounding.checked, ...(grounding.unconfirmed ? { unconfirmed: grounding.unconfirmed } : {}) },
      answered,
    });
  } catch (err) {
    console.error('Chat error:', err.stack || err);
    res.status(500).json({ error: 'Chat failed' });
  }
}

module.exports = { chatWithProject };
