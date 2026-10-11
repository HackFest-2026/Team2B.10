const { summarize } = require('./draftGenerator');
const { CLASSIFICATIONS } = require('../sourceTypes');

/**
 * The draft as one reader may see it. Statements above the reader's clearance are replaced by a count,
 * and everything derived (statistics, classification, rejected list) is recomputed from what is visible.
 */
function viewFor(draft, clearance) {
  const doc = draft.toObject ? draft.toObject() : draft;
  let redacted = 0;
  const sections = doc.sections.map((s) => {
    const claims = s.claims.filter((c) => c.classification <= clearance);
    const hidden = s.claims.length - claims.length;
    redacted += hidden;
    return { key: s.key, heading: s.heading, claims, redacted: hidden };
  });
  const rejected = doc.rejected.filter((r) => (r.classification || 0) <= clearance).map(({ classification, ...rest }) => rest);
  const visible = { sections, rejected };
  const classification = sections.flatMap((s) => s.claims).reduce((m, c) => Math.max(m, c.classification), 0);
  return {
    id: doc._id, projectId: doc.projectId, title: doc.title, template: doc.template, focus: doc.focus, status: doc.status, error: doc.error,
    progress: doc.progress, version: doc.version, createdAt: doc.createdAt, generatedAt: doc.generatedAt, sourceDocIds: doc.sourceDocIds,
    sections, rejected: rejected.length, rejectedList: rejected,
    stats: doc.status === 'READY' ? summarize(visible) : {},
    classification, classificationName: CLASSIFICATIONS[classification], redacted, model: doc.model, revisions: doc.revisions.length,
  };
}

module.exports = { viewFor };
