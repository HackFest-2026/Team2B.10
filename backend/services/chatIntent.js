// Questions that are not about what the documents say. Greetings and questions about the project itself are answered
// without a model; everything else goes through retrieval, and only when nothing in the sources is relevant does the
// model answer as a general assistant (labelled as such, never with citations).

const GREETING = /^\s*(hi+|hello+|hey+|hiya|yo|sup|good (morning|afternoon|evening|day)|greetings|namaste|how are (you|u)|how'?s it going|what'?s up|thanks?( you)?|thank u|ok(ay)?|cool|great|bye|goodbye)\W*$/i;
const META = [
  /\bhow many (documents?|docs?|files?|sources?|papers?|logs?|units?|paragraphs?|pages?|passages?)\b/i,
  /\b(which|what|list|show)\b[^?]{0,30}\b(documents?|docs?|files?|sources?|papers?)\b[^?]{0,30}\b(are|do|have|uploaded|available|in (this|the) project|here)\b/i,
  /\b(list|show)( me)?( all)?( the)? (documents?|docs?|files?|sources?|papers?)\b/i,
  /\bwhat (all )?(can|could) you\b|what do you do|what are you|who are you|how (do|can) i use (you|this)|\bhelp\b/i,
];

// Questions about the collection as a whole: no single passage answers them, so retrieval takes a share of every document.
const OVERVIEW = [
  /\b(explain|describe|summari[sz]e|overview|tell me about|walk me through|introduce)\b[^?]{0,50}\b(project|documents?|docs?|papers?|files?|sources?|collection|corpus|these|them|everything|all)\b/i,
  /\b(what|which)\b[^?]{0,25}\b(is|are)\b[^?]{0,25}\b(this|these|the)\b[^?]{0,25}\b(about|cover(s|ed)?|discuss(es|ed)?)\b/i,
  /\b(common|in common|shared|similar(ity|ities)?|overlap|differences?|differ|compare|comparison|contrast|relationship|how (do|are) (they|these)[^?]{0,20}(related|connected|different))\b/i,
  /\b(most|main|key|central|core|major|primary|overall|big|top)\b[^?]{0,30}\b(concepts?|ideas?|topics?|themes?|points?|findings?|contributions?|takeaways?|conclusions?|messages?)\b/i,
  /\b(summary|summari[sz]e|tl;?dr|gist|in a nutshell)\b/i,
];

const KINDS = { scan: 'scanned document', report: 'report / document', chatlog: 'conversation log', syslog: 'system log' };

function classifyIntent(question = '') {
  const q = question.trim();
  if (!q) return 'empty';
  if (q.split(/\s+/).length <= 6 && GREETING.test(q)) return 'greeting';
  if (META.some((re) => re.test(q))) return 'meta';
  if (OVERVIEW.some((re) => re.test(q))) return 'overview';
  return 'question';
}

const CAPABILITIES = 'I can answer questions about the documents in this project and cite the exact passage for each statement. Ask about their content, or use the scope selector to limit me to one document or a few. I can also answer general questions, and I will say so when an answer does not come from your documents.';

function greetingReply(question, projectName) {
  if (/thank/i.test(question)) return "You're welcome. Ask me anything about the documents whenever you like.";
  if (/^\s*(bye|goodbye)/i.test(question)) return 'Goodbye. Your documents will be here when you are back.';
  if (/how are|how'?s it going|what'?s up/i.test(question)) return `I'm doing well, thanks. I'm ready to help with ${projectName ? `**${projectName}**` : 'your documents'}: ask me about their content.`;
  return `Hello! I'm the research assistant for ${projectName ? `**${projectName}**` : 'this project'}. ${CAPABILITIES}`;
}

/** docs: [{filename, sourceType, classification, pageCount, units}] already limited to scope and clearance. */
function projectInfoReply(question, docs, projectName, scopeLabel) {
  if (/what (all )?(can|could) you|what do you do|what are you|who are you|how (do|can) i use|\bhelp\b/i.test(question)) return CAPABILITIES;
  if (!docs.length) return `There are no processed documents ${scopeLabel} yet. Upload a source in the Workspace and I can answer questions about it.`;
  const units = docs.reduce((n, d) => n + d.units, 0);
  const pages = docs.reduce((n, d) => n + (d.pageCount || 0), 0);
  const lines = docs.map((d) => `- **${d.filename}** (${KINDS[d.sourceType] || d.sourceType}${d.pageCount ? `, ${d.pageCount} pages` : ''}, ${d.units} passages)`);
  const head = `${scopeLabel === 'in this project' ? 'This project' : `Within ${scopeLabel}`} has **${docs.length}** processed document${docs.length === 1 ? '' : 's'}${pages ? `, ${pages} pages in total,` : ''} split into **${units}** citable passages${projectName ? ` (project **${projectName}**)` : ''}:`;
  return `${head}\n\n${lines.join('\n')}`;
}

const GENERAL_SYSTEM = `You are a helpful assistant inside a document-analysis tool. Nothing in the user's documents matched this question closely enough, so answer from general knowledge only.
Keep it concise and accurate; if you are not sure, say so. Say nothing about what the user's documents do or do not contain, and never claim to have read them. If the question clearly asks about specific data of theirs (for example counts, names or values in their logs or reports), say that you cannot work that out from general knowledge, and suggest asking about a specific passage or narrowing the scope to one document.`;

module.exports = { classifyIntent, greetingReply, projectInfoReply, GENERAL_SYSTEM, CAPABILITIES };
