import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { listProjects, createProject, deleteProject } from '../api';
import { useToast } from '../hooks/useToast';
import ConfirmModal from '../components/ConfirmModal';
import UserMenu from '../components/UserMenu';

function ProjectCard({ project, onDelete, onClick }) {
  const date = new Date(project.createdAt).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });

  return (
    <div
      className="group card cursor-pointer"
      style={{ padding: '22px 24px', borderRadius: 16 }}
      onClick={onClick}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'var(--surface3)', border: '1px solid var(--border)' }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} style={{ color: 'var(--accent)' }}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
          </svg>
        </div>

        <button
          onClick={(e) => { e.stopPropagation(); onDelete(project._id); }}
          className="opacity-0 group-hover:opacity-100 transition-opacity w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ color: 'var(--text-dim)', background: 'var(--surface2)', border: '1px solid var(--border)' }}
          title="Delete project"
        >
          <svg width="11" height="11" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Name + date */}
      <div className="mt-4">
        <p
          className="leading-snug truncate"
          style={{
            color: 'var(--text)',
            fontWeight: 700,
            fontSize: 15,
            letterSpacing: '-0.02em',
          }}
        >
          {project.name}
        </p>
        <p className="text-[12px] mt-1" style={{ color: 'var(--text-dim)' }}>{date}</p>
      </div>

      {/* Footer */}
      <div className="mt-5 pt-4 flex items-center gap-2" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--success)' }} />
        <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-dim)', letterSpacing: '0.12em' }}>Active</span>
        {project.summaryStatus === 'DONE' && (
          <span
            className="ml-auto flex items-center gap-1 text-[11px] font-bold"
            style={{ color: 'var(--accent)', opacity: 0.6 }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
            Summarized
          </span>
        )}
        <svg className="ml-auto w-3 h-3 opacity-25" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={project.summaryStatus === 'DONE' ? { display:'none' } : {}}>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const navigate = useNavigate();
  const { toast, ToastContainer } = useToast();

  const fetchProjects = async () => {
    try {
      const { data } = await listProjects();
      setProjects(data);
    } catch {
      toast('Failed to load projects', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchProjects(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await createProject(newName.trim());
      setNewName('');
      toast('Project created', 'success');
      fetchProjects();
    } catch {
      toast('Failed to create project', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = (id) => {
    setConfirmDelete(id);
  };

  const confirmDeleteProject = async () => {
    const id = confirmDelete;
    setConfirmDelete(null);
    try {
      await deleteProject(id);
      toast('Project deleted', 'info');
      setProjects((prev) => prev.filter((p) => p._id !== id));
    } catch {
      toast('Failed to delete', 'error');
    }
  };

  return (
    <div className="min-h-screen">
      <ToastContainer />
      <ConfirmModal
        open={!!confirmDelete}
        title="Delete project"
        message="Are you sure you want to delete this project? This action cannot be undone."
        onConfirm={confirmDeleteProject}
        onCancel={() => setConfirmDelete(null)}
      />

      <nav className="navbar">
        <Link to="/" className="navbar-brand" style={{ textDecoration: 'none' }}>Mirage</Link>
        <div className="ml-auto flex items-center gap-3">
          <Link
            to="/code"
            className="text-[13px] font-semibold transition-colors"
            style={{ color: 'var(--text-dim)' }}
            onMouseEnter={e => e.target.style.color = 'var(--text)'}
            onMouseLeave={e => e.target.style.color = 'var(--text-dim)'}
          >
            Code
          </Link>
          <span
            className="px-3 py-1 rounded-full font-semibold text-[11px] tracking-[0.1em] uppercase"
            style={{ color: 'var(--text-dim)', background: 'var(--surface3)', border: '1px solid var(--border)' }}
          >
            Research Intelligence
          </span>
          <UserMenu />
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-8 py-16">

        {/* ── Hero header ── */}
        <div className="mb-16 pb-16" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-8">
            <span className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: 'var(--text-dim)' }}>
              Workspace
            </span>
          </div>
          <h1
            className="leading-[1.0] mb-5"
            style={{
              fontSize: 'clamp(3rem, 7vw, 5.5rem)',
              fontWeight: 800,
              color: 'var(--text)',
              letterSpacing: '-0.04em',
            }}
          >
            Research,<br />
            <span style={{ color: 'var(--text-dim)', fontWeight: 300 }}>made clear.</span>
          </h1>
          <p className="max-w-lg text-[16px] leading-relaxed" style={{ color: 'var(--text-dim)', fontWeight: 400 }}>
            Upload your PDFs. Extract what matters. Work through documents with an AI that understands context.
          </p>
        </div>

        {/* ── New project form ── */}
        <div className="mb-16">
          <div className="flex items-center gap-2 mb-5">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: 'var(--text-dim)' }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            <h2 className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-dim)' }}>New Project</h2>
          </div>
          <div className="card p-6 max-w-xl" style={{ borderRadius: 14 }}>
            <form onSubmit={handleCreate} className="flex gap-3">
              <input
                className="input flex-1"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Name your project..."
                disabled={creating}
              />
              <button
                type="submit"
                className="btn btn-primary shrink-0"
                disabled={creating || !newName.trim()}
                style={{ minWidth: 90 }}
              >
                {creating
                  ? <span className="spinner" style={{ width: 16, height: 16, borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />
                  : 'Create'}
              </button>
            </form>
          </div>
        </div>

        {/* ── Projects list ── */}
        <div>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: 'var(--text-dim)' }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
              <h2 className="text-[12px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-dim)' }}>Projects</h2>
            </div>
            {projects.length > 0 && (
              <span
                className="text-[12px] font-bold px-2.5 py-1 rounded-full"
                style={{ color: 'var(--text-dim)', background: 'var(--surface2)', border: '1px solid var(--border)' }}
              >
                {projects.length}
              </span>
            )}
          </div>

          {loading ? (
            <div className="flex justify-center py-24">
              <div className="spinner" style={{ width: 28, height: 28, borderWidth: 2.5 }} />
            </div>
          ) : projects.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center py-24 rounded-2xl"
              style={{ border: '1.5px dashed var(--border)', background: 'var(--surface2)' }}
            >
              <div
                className="w-14 h-14 rounded-2xl mb-5 flex items-center justify-center"
                style={{ background: 'var(--surface3)', border: '1px solid var(--border)' }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--text-dim)' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
              </div>
              <h3
                className="text-[17px] mb-2"
                style={{
                  color: 'var(--text)',
                  fontWeight: 700,
                  letterSpacing: '-0.03em',
                }}
              >No projects yet</h3>
              <p className="text-[14px]" style={{ color: 'var(--text-dim)' }}>Create your first project above to get started</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {projects.map((p) => (
                <ProjectCard
                  key={p._id}
                  project={p}
                  onDelete={handleDelete}
                  onClick={() => navigate(`/projects/${p._id}`)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <footer className="py-8 text-center" style={{ borderTop: '1px solid var(--border)' }}>
        <span
          className="text-[13px] font-semibold cursor-pointer"
          style={{ color: 'var(--text-dim)' }}
          onClick={() => new Audio('/sounds/fahh.mp3').play()}
        >
          check
        </span>
      </footer>
    </div>
  );
}
