import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getProject, listDocuments, reprocessDocument } from '../api';
import ClassificationBadge from '../components/ClassificationBadge';
import { SOURCE_TYPES } from '../classification';
import UploadArea from '../components/UploadArea';
import ChatBox from '../components/ChatBox';
import KnowledgeGraph3D from '../components/KnowledgeGraph3D';
import ProjectSummary from '../components/ProjectSummary';
import AnalysisPanel from '../components/AnalysisPanel';
import DraftPanel from '../components/DraftPanel';
import { useToast } from '../hooks/useToast';
import UserMenu from '../components/UserMenu';

const POLL_INTERVAL = 3000;

function StatusBadge({ status }) {
  const map = { PROCESSING: 'badge-processing', DONE: 'badge-done', ERROR: 'badge-error' };
  const labels = { PROCESSING: 'Processing', DONE: 'Ready', ERROR: 'Error' };
  return (
    <span className={`badge ${map[status] || 'badge-uploaded'}`}>
      {status === 'PROCESSING' && (
        <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} />
      )}
      {labels[status] || status}
    </span>
  );
}

export default function ProjectPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { toast, ToastContainer } = useToast();
  const [project, setProject] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState('documents');
  const [graphMode, setGraphMode] = useState('insights');
  const pollRef = useRef(null);
  const prevStatuses = useRef({});

  const fetchAll = async () => {
    try {
      const [projRes, docsRes] = await Promise.all([
        getProject(projectId),
        listDocuments(projectId),
      ]);
      setProject(projRes.data);
      const docs = docsRes.data;

      docs.forEach((doc) => {
        if (prevStatuses.current[doc._id] === 'PROCESSING' && doc.status === 'DONE') {
          toast(`"${doc.filename}" is ready`, 'success', 5000);
        }
        if (prevStatuses.current[doc._id] === 'PROCESSING' && doc.status === 'ERROR') {
          toast(`"${doc.filename}" failed to process`, 'error', 5000);
        }
        prevStatuses.current[doc._id] = doc.status;
      });

      setDocuments(docs);
    } catch {
      if (!project) toast('Failed to load project', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    pollRef.current = setInterval(fetchAll, POLL_INTERVAL);
    return () => clearInterval(pollRef.current);
  }, [projectId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="spinner w-7 h-7 border-[2px]" />
      </div>
    );
  }

  const processingCount = documents.filter((d) => d.status === 'PROCESSING').length;

  return (
    <div className="min-h-screen">
      <ToastContainer />

      <nav className="navbar">
        <span className="navbar-brand cursor-pointer" onClick={() => navigate('/')}>
          Mirage
        </span>
        <span className="navbar-sep">/</span>
        <span className="text-[16px] font-semibold" style={{ color: 'var(--text)' }}>{project?.name}</span>

        <div className="ml-auto flex items-center gap-3">
          {processingCount > 0 && (
            <div
              className="flex items-center gap-2 text-[12px] font-semibold px-3 py-1.5 rounded-full"
              style={{ color: '#a16207', background: '#fffbeb', border: '1px solid #fde68a' }}
            >
              <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5, borderColor: '#fcd34d', borderTopColor: '#d97706' }} />
              Processing {processingCount} file{processingCount > 1 ? 's' : ''}
            </div>
          )}
          <UserMenu />
        </div>
      </nav>

      <div className="max-w-[1280px] mx-auto px-8 py-8 pb-14">
        <div className="flex items-center gap-1 mb-7 w-fit" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 4 }}>
          {['documents', 'summary', 'analysis', 'document', 'graph'].map((v) => {
            const labels = { documents: 'Workspace', summary: 'Summary', analysis: 'Analysis', document: 'Report', graph: 'Graph' };
            return (
              <button
                key={v}
                onClick={() => setActiveView(v)}
                style={{
                  padding: '7px 18px',
                  borderRadius: 9,
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '-0.01em',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'background 0.12s ease, color 0.12s ease',
                  ...(activeView === v
                    ? { background: 'var(--accent)', color: '#fff' }
                    : { background: 'transparent', color: 'var(--text-dim)' })
                }}
              >
                {labels[v]}
              </button>
            );
          })}
        </div>

        {activeView === 'summary' ? (
          <ProjectSummary projectId={projectId} projectName={project?.name || ''} />
        ) : activeView === 'document' ? (
          <DraftPanel projectId={projectId} documents={documents} />
        ) : activeView === 'analysis' ? (
          <AnalysisPanel projectId={projectId} />
        ) : activeView === 'graph' ? (
          <div>
            <div className="flex gap-2 mb-4">
              {[['insights', 'Insights'], ['entities', 'Entities & conflicts']].map(([m, label]) => (
                <button key={m} className={`btn ${graphMode === m ? 'btn-primary' : 'btn-ghost'}`} style={{ fontSize: 13 }} onClick={() => setGraphMode(m)}>{label}</button>
              ))}
            </div>
            <KnowledgeGraph3D key={graphMode} mode={graphMode} projectId={projectId} projectName={project?.name || ''} />
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_390px] gap-7 items-start">
            <div>
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-dim)' }}>Documents</h2>
                <span className="text-[12px] font-semibold" style={{ color: 'var(--text-dim)' }}>{documents.length} uploaded</span>
              </div>

              <UploadArea projectId={projectId} onUploadComplete={fetchAll} />

              <div className="mt-5">
                {documents.length === 0 ? (
                  <div className="empty-state card border-dashed">
                    <p className="text-[15px]">No sources yet — upload a scan, report, conversation log or system log above</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {documents.map((doc) => {
                      const icons = {
                        DONE: (
                          <svg className="w-5 h-5" style={{ color: 'var(--accent)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                          </svg>
                        ),
                        ERROR: (
                          <svg className="w-4.5 h-4.5" style={{ color: 'var(--error)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                          </svg>
                        ),
                        PROCESSING: (
                          <span className="spinner" style={{ width: 16, height: 16 }} />
                        ),
                      };

                      return (
                        <div
                          key={doc._id}
                          className="flex items-center gap-4 px-5 py-4 rounded-2xl transition-all duration-150"
                          style={{
                            border: '1px solid var(--border)',
                            background: 'var(--surface)',
                            cursor: doc.status === 'DONE' ? 'pointer' : 'default',
                          }}
                          onMouseEnter={e => { if (doc.status === 'DONE') { e.currentTarget.style.borderColor = 'var(--border-strong)'; e.currentTarget.style.background = 'var(--surface2)'; } }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--surface)'; }}
                          onClick={() => doc.status === 'DONE' && navigate(doc.annotatedFileUrl ? `/projects/${projectId}/documents/${doc._id}` : `/projects/${projectId}/documents/${doc._id}/units`)}
                        >
                          <div
                            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                            style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}
                          >
                            {icons[doc.status] || icons.PROCESSING}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[15px] font-semibold truncate" style={{ color: 'var(--text)' }}>{doc.filename}</p>
                            <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-dim)' }}>
                              {SOURCE_TYPES[doc.sourceType]?.label || 'Source'} ·{' '}
                              {doc.pageCount ? `${doc.pageCount} pages · ` : ''}
                              {doc.status === 'DONE' ? `${doc.unitCount} units · ` : ''}
                              {doc.ocrConfidence != null ? `OCR ${doc.ocrConfidence}% · ` : ''}
                              {new Date(doc.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                            </p>
                            {doc.warnings?.length > 0 && (
                              <p className="text-[12px] mt-1" style={{ color: 'var(--warning, #8a6200)' }}>⚠ {doc.warnings.join(' · ')}</p>
                            )}
                            {doc.errorMessage && (
                              <p className="text-[12px] mt-1" style={{ color: 'var(--error)' }}>{doc.errorMessage}</p>
                            )}
                          </div>
                          <ClassificationBadge level={doc.classification} />
                          {doc.status === 'DONE' && doc.pageCount > 0 && doc.insightCount === 0 && (
                            <button
                              className="btn btn-ghost"
                              style={{ fontSize: 12, padding: '4px 10px' }}
                              title="This PDF has no highlights or notes yet. Read it again with the language model to add them (takes a few minutes)."
                              onClick={async (e) => { e.stopPropagation(); try { await reprocessDocument(projectId, doc._id); } catch (err) { /* shown by the next refresh */ } fetchAll(); }}
                            >
                              Add highlights
                            </button>
                          )}
                          {doc.status === 'DONE' && doc.annotatedFileUrl && (
                            <button
                              className="btn btn-ghost"
                              style={{ fontSize: 12, padding: '4px 10px' }}
                              onClick={(e) => { e.stopPropagation(); navigate(`/projects/${projectId}/documents/${doc._id}/units`); }}
                            >
                              Units
                            </button>
                          )}
                          <StatusBadge status={doc.status} />
                          {doc.status === 'DONE' && (
                            <svg className="w-4 h-4 shrink-0" style={{ color: 'var(--border-strong)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                            </svg>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="sticky top-[90px] h-[calc(100vh-124px)]">
              <ChatBox projectId={projectId} projectName={project?.name || ''} documents={documents} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
