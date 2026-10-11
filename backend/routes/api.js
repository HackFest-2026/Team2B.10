const express = require('express');
const router = express.Router();

const requireAuth = require('../middleware/auth');
const loadClearance = require('../middleware/clearance');
const { loadOwnedProject, loadOwnedDocument } = require('../middleware/access');
const { createProject, listProjects, getProject, deleteProject, generateSummary, getProjectSummary } = require('../controllers/projectController');
const { reprocessDocument, uploadDocument, listDocuments, getDocument, getInsights, createInsight, listUnits } = require('../controllers/documentController');
const { chatWithProject } = require('../controllers/chatController');
const { getProjectKnowledgeGraph } = require('../controllers/graphController');
const { uploadFile, downloadFile } = require('../controllers/fileController');
const analysis = require('../controllers/analysisController');
const drafts = require('../controllers/draftController');
const { auditLog } = require('../controllers/auditController');

// Every route below requires a valid token.
router.use(requireAuth);
router.use(loadClearance);

// Ownership is enforced centrally: any route carrying one of these params is checked
// before its handler runs, so a new route cannot forget the check.
router.param('id', loadOwnedProject);
router.param('projectId', loadOwnedProject);
router.param('documentId', loadOwnedDocument);
router.param('draftId', drafts.loadDraft);

// Projects
router.post('/projects', createProject);
router.get('/projects', listProjects);
router.get('/projects/:id', getProject);
router.delete('/projects/:id', deleteProject);
router.post('/projects/:id/summary', generateSummary);
router.get('/projects/:id/summary', getProjectSummary);
router.get('/projects/:projectId/knowledge-graph', getProjectKnowledgeGraph);

// Files (local storage)
router.post('/files', uploadFile);
router.get('/files/:key', downloadFile);

// Documents
router.post('/projects/:projectId/upload', uploadDocument);
router.get('/projects/:projectId/documents', listDocuments);
router.post('/projects/:projectId/documents/:documentId/reprocess', reprocessDocument);
router.get('/projects/:projectId/documents/:documentId/insights', getInsights);
router.post('/projects/:projectId/documents/:documentId/insights', createInsight);
router.get('/projects/:projectId/documents/:documentId/units', listUnits);
router.get('/documents/:documentId', getDocument);

// Entity resolution, duplicates and cross-source conflicts (all clearance-filtered)
router.post('/projects/:projectId/analysis', analysis.runAnalysisRoute);
router.get('/projects/:projectId/analysis', analysis.analysisStatus);
router.get('/projects/:projectId/entities', analysis.listEntities);
router.post('/projects/:projectId/entities/decisions', analysis.decideEntities);
router.get('/projects/:projectId/conflicts', analysis.listConflicts);
router.patch('/projects/:projectId/conflicts/:conflictId', analysis.reviewConflict);
router.get('/projects/:projectId/duplicates', analysis.listDuplicates);
router.get('/projects/:projectId/gaps', analysis.listGaps);
router.get('/projects/:projectId/facts', analysis.listFacts);
router.get('/projects/:projectId/entity-graph', analysis.entityGraph);

// Documents synthesised from the sources: claim-level citations, entailment-checked, exportable as signed PDF + manifest
router.get('/projects/:projectId/drafts/templates', drafts.listTemplates);
router.get('/projects/:projectId/drafts', drafts.listDrafts);
router.post('/projects/:projectId/drafts', drafts.createDraft);
router.get('/projects/:projectId/drafts/:draftId', drafts.getDraft);
router.delete('/projects/:projectId/drafts/:draftId', drafts.deleteDraft);
router.post('/projects/:projectId/drafts/:draftId/claims', drafts.addClaim);
router.patch('/projects/:projectId/drafts/:draftId/claims/:claimId', drafts.editClaim);
router.delete('/projects/:projectId/drafts/:draftId/claims/:claimId', drafts.deleteClaim);
router.post('/projects/:projectId/drafts/:draftId/export', drafts.exportRoute);
router.get('/projects/:projectId/drafts/:draftId/exports', drafts.listExports);
router.get('/projects/:projectId/exports/:exportId/pdf', drafts.download('pdf'));
router.get('/projects/:projectId/exports/:exportId/manifest', drafts.download('manifest'));
router.post('/verify', drafts.verifyRoute);
router.get('/signing-key', drafts.signingKey);

// Chat (strictly project-scoped)
router.post('/projects/:projectId/chat', chatWithProject);

// Audit trail
router.get('/audit', auditLog);

module.exports = router;
