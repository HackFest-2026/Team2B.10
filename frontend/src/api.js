import axios from 'axios';

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:5001/api',
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT token to every request if present
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Projects
export const createProject = (name) => api.post('/projects', { name });
export const listProjects = () => api.get('/projects');
export const getProject = (id) => api.get(`/projects/${id}`);
export const deleteProject = (id) => api.delete(`/projects/${id}`);
export const getProjectKnowledgeGraph = (projectId, params = {}) =>
  api.get(`/projects/${projectId}/knowledge-graph`, { params });

// Documents
export const uploadFile = (file) => {
  const form = new FormData();
  form.append('file', file);
  return api.post('/files', form, { headers: { 'Content-Type': 'multipart/form-data' } });
};
export const uploadDocument = (projectId, fileUrl, filename, sourceType, classification) =>
  api.post(`/projects/${projectId}/upload`, { fileUrl, filename, sourceType, classification });
export const listUnits = (projectId, documentId, params = {}) =>
  api.get(`/projects/${projectId}/documents/${documentId}/units`, { params });

// Files are served by the authenticated backend, so the token must travel with the request.
export const authHeaders = () => {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};
export const fileHref = (fileUrl) =>
  /^https?:\/\//.test(fileUrl || '')
    ? fileUrl
    : `${api.defaults.baseURL.replace(/\/api$/, '')}${fileUrl}`;
export async function downloadFile(fileUrl, filename = 'document.pdf') {
  const resp = await api.get(fileUrl.replace(/^\/api/, ''), { responseType: 'blob' });
  const href = URL.createObjectURL(resp.data);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(href);
}
export const listDocuments = (projectId) => api.get(`/projects/${projectId}/documents`);
export const reprocessDocument = (projectId, documentId) => api.post(`/projects/${projectId}/documents/${documentId}/reprocess`, {});
export const getDocument = (documentId, projectId) =>
  api.get(`/documents/${documentId}`, { params: { projectId } });
export const getInsights = (projectId, documentId) =>
  api.get(`/projects/${projectId}/documents/${documentId}/insights`);

// Insights
export const createInsight = (projectId, documentId, payload) =>
  api.post(`/projects/${projectId}/documents/${documentId}/insights`, payload);

// Chat
export const sendChat = (projectId, data) =>
  api.post(`/projects/${projectId}/chat`, data);

// Project Summary
export const generateProjectSummary = (projectId) =>
  api.post(`/projects/${projectId}/summary`);
export const getProjectSummary = (projectId) =>
  api.get(`/projects/${projectId}/summary`);

// Analysis: entities, duplicates, cross-source conflicts
export const runAnalysis = (projectId) => api.post(`/projects/${projectId}/analysis`, {});
export const getAnalysisStatus = (projectId) => api.get(`/projects/${projectId}/analysis`);
export const listEntities = (projectId) => api.get(`/projects/${projectId}/entities`);
export const decideEntities = (projectId, keyA, keyB, decision) =>
  api.post(`/projects/${projectId}/entities/decisions`, { keyA, keyB, decision });
export const listConflicts = (projectId, status) =>
  api.get(`/projects/${projectId}/conflicts`, { params: status ? { status } : {} });
export const reviewConflict = (projectId, conflictId, status) =>
  api.patch(`/projects/${projectId}/conflicts/${conflictId}`, { status });
export const listDuplicates = (projectId) => api.get(`/projects/${projectId}/duplicates`);
export const getEntityGraph = (projectId) => api.get(`/projects/${projectId}/entity-graph`);
export const listGaps = (projectId) => api.get(`/projects/${projectId}/gaps`);

// Documents synthesised from sources (verified claims, signed export)
export const listDraftTemplates = (projectId) => api.get(`/projects/${projectId}/drafts/templates`);
export const listDrafts = (projectId) => api.get(`/projects/${projectId}/drafts`);
export const createDraft = (projectId, body) => api.post(`/projects/${projectId}/drafts`, body);
export const getDraft = (projectId, draftId) => api.get(`/projects/${projectId}/drafts/${draftId}`);
export const deleteDraft = (projectId, draftId) => api.delete(`/projects/${projectId}/drafts/${draftId}`);
export const editDraftClaim = (projectId, draftId, claimId, text) => api.patch(`/projects/${projectId}/drafts/${draftId}/claims/${claimId}`, { text });
export const addDraftClaim = (projectId, draftId, body) => api.post(`/projects/${projectId}/drafts/${draftId}/claims`, body);
export const deleteDraftClaim = (projectId, draftId, claimId) => api.delete(`/projects/${projectId}/drafts/${draftId}/claims/${claimId}`);
export const exportDraft = (projectId, draftId, includeUnverified) => api.post(`/projects/${projectId}/drafts/${draftId}/export`, { includeUnverified });
export const listExports = (projectId, draftId) => api.get(`/projects/${projectId}/drafts/${draftId}/exports`);
export const verifyExport = (manifestFile, pdfFile) => {
  const form = new FormData();
  form.append('manifest', manifestFile);
  if (pdfFile) form.append('pdf', pdfFile);
  return api.post('/verify', form, { headers: { 'Content-Type': 'multipart/form-data' } });
};
