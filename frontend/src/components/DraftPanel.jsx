import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  listDraftTemplates, listDrafts, createDraft, getDraft, deleteDraft, editDraftClaim, addDraftClaim,
  deleteDraftClaim, exportDraft, listExports, verifyExport, downloadFile,
} from '../api';
import ClassificationBadge from './ClassificationBadge';
import ReportDocument from './ReportDocument';
import { CLASSIFICATIONS } from '../classification';
import { useAuth } from '../context/AuthContext';

const card = { border: '1px solid var(--border)', background: 'var(--surface)', borderRadius: 16, padding: '16px 20px' };
const muted = { color: 'var(--text-dim)', fontSize: 12 };
const h2 = { fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-dim)', margin: '24px 0 10px' };
const input = { border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px', background: 'var(--surface)', color: 'var(--text)', fontSize: 14, fontFamily: 'inherit' };

const STATUS = {
  supported: { label: 'Verified', color: '#2f6b3b', bg: 'rgba(47,107,59,0.12)' },
  conflicted: { label: 'Sources conflict', color: '#a3211f', bg: 'rgba(190,40,36,0.12)' },
  unsupported: { label: 'Unverified', color: '#6b625b', bg: 'rgba(107,98,91,0.14)' },
  human: { label: 'Analyst note · no source', color: '#8a6200', bg: 'rgba(200,150,0,0.16)' },
};

function Chip({ status }) {
  const s = STATUS[status];
  return <span className="text-[10.5px] font-bold uppercase tracking-[0.06em] px-2 py-[3px] rounded-md whitespace-nowrap" style={{ color: s.color, background: s.bg }}>{s.label}</span>;
}

function ClaimRow({ claim, sources, onEdit, onDelete, busy }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(claim.text);
  const save = async () => { await onEdit(claim.id, text); setEditing(false); };
  return (
    <div style={{ padding: '10px 14px', borderRadius: 12, border: '1px solid var(--border)', background: claim.status === 'unsupported' ? 'var(--surface2)' : 'var(--surface)', opacity: claim.status === 'unsupported' ? 0.8 : 1 }}>
      {editing ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} style={{ ...input, flex: 1 }} />
          <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={busy || !text.trim()} onClick={save}>Save</button>
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => { setEditing(false); setText(claim.text); }}>Cancel</button>
        </div>
      ) : (
        <p style={{ color: 'var(--text)', fontSize: 14 }}>{claim.text}</p>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
        <Chip status={claim.status} />
        <ClassificationBadge level={claim.classification} />
        {claim.edited && <span style={muted}>edited</span>}
        {claim.entailment != null && <span style={muted}>entailment {Math.round(claim.entailment * 100)}%</span>}
        {claim.evidence.map((e, i) => {
          const src = sources[e.unitId];
          return (
            <span key={i} title={`“${e.quote}”`} style={{ ...muted, border: '1px solid var(--border)', borderRadius: 6, padding: '1px 6px' }}>
              {src ? src : 'source'}
            </span>
          );
        })}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {claim.authored !== 'conflict-report' && !editing && <button className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => setEditing(true)}>Edit</button>}
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }} disabled={busy} onClick={() => onDelete(claim.id)}>Delete</button>
        </span>
      </div>
      {claim.evidence.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary style={{ ...muted, cursor: 'pointer' }}>Evidence</summary>
          {claim.evidence.map((e, i) => <p key={i} style={{ ...muted, fontStyle: 'italic', marginTop: 3 }}>“{e.quote}”</p>)}
        </details>
      )}
    </div>
  );
}

export default function DraftPanel({ projectId, documents }) {
  const { user } = useAuth();
  const [templates, setTemplates] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [open, setOpen] = useState(null);       // full draft view
  const [exportsList, setExportsList] = useState([]);
  const [form, setForm] = useState({ title: '', template: 'incident', focus: '' });
  const [picked, setPicked] = useState(null);   // null = all readable sources
  const [includeUnverified, setIncludeUnverified] = useState(false);
  const [note, setNote] = useState({ sectionKey: '', text: '' });
  const [verifyResult, setVerifyResult] = useState(null);
  const [view, setView] = useState('document'); // 'document' | 'review'
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pollRef = useRef(null);
  const readable = documents.filter((d) => d.status === 'DONE');
  const sources = {};
  if (open) open.sections.forEach((s) => s.claims.forEach((c) => c.evidence.forEach((e) => {
    const doc = documents.find((d) => d._id === e.documentId);
    sources[e.unitId] = doc ? doc.filename : 'source';
  })));

  const refreshList = useCallback(async () => setDrafts((await listDrafts(projectId)).data), [projectId]);
  const load = useCallback(async (id) => {
    const { data } = await getDraft(projectId, id);
    setOpen(data);
    if (data.status === 'READY') setExportsList((await listExports(projectId, id)).data);
    return data;
  }, [projectId]);

  useEffect(() => { listDraftTemplates(projectId).then((r) => setTemplates(r.data)); refreshList(); return () => clearInterval(pollRef.current); }, [projectId, refreshList]);

  const watch = (id) => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const d = await load(id);
      if (d.status !== 'GENERATING') { clearInterval(pollRef.current); refreshList(); }
    }, 2500);
  };

  const run = async (fn) => {
    setBusy(true); setError('');
    try { return await fn(); } catch (e) { setError(e.response?.data?.error || e.message); } finally { setBusy(false); }
  };

  const create = () => run(async () => {
    const { data } = await createDraft(projectId, { ...form, sourceDocIds: picked || undefined });
    await load(data.id); watch(data.id); refreshList();
  });

  const claimAction = (fn) => run(async () => { await fn(); await load(open.id); });

  const doExport = () => run(async () => {
    await exportDraft(projectId, open.id, includeUnverified);
    setExportsList((await listExports(projectId, open.id)).data);
  });

  const check = (manifestFile, pdfFile) => run(async () => setVerifyResult((await verifyExport(manifestFile, pdfFile)).data));

  const stats = open?.stats || {};
  return (
    <div style={{ maxWidth: 980 }}>
      {error && <p style={{ color: 'var(--error)', marginBottom: 10 }}>{error}</p>}

      {!open && (
        <>
          <div style={card}>
            <p style={{ fontWeight: 700, color: 'var(--text)', fontSize: 16 }}>Create a verified report</p>
            <p style={{ ...muted, marginBottom: 12 }}>
              Writes one document from your sources. Every statement must quote a source verbatim and follow from it according to a local entailment model; conflicts between sources are listed, never smoothed over.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <input style={{ ...input, flex: 1, minWidth: 220 }} placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              <select style={input} value={form.template} onChange={(e) => setForm({ ...form, template: e.target.value })}>
                {templates.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </div>
            {templates.filter((t) => t.key === form.template).map((t) => (
              <div key={t.key} data-testid="template-help" style={{ marginTop: 10, padding: '10px 14px', borderRadius: 12, background: 'var(--surface2)', border: '1px solid var(--border)' }}>
                <p style={{ color: 'var(--text)', fontSize: 13 }}><b>{t.label}.</b> {t.description}</p>
                <p style={{ ...muted, marginTop: 4 }}>Best for: {t.bestFor}</p>
                <p style={{ ...muted, marginTop: 4 }}>Sections: {t.sections.join(' · ')} · Conflicts between sources</p>
              </div>
            ))}
            <input style={{ ...input, width: '100%', marginTop: 10 }} placeholder="Optional focus, e.g. “the atlas-db-02 outage”" value={form.focus} onChange={(e) => setForm({ ...form, focus: e.target.value })} />
            <p style={{ ...muted, margin: '12px 0 6px' }}>Sources (you can only select material within your clearance: {CLASSIFICATIONS[user?.clearance ?? 0]})</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {readable.map((d) => {
                const on = picked ? picked.includes(d._id) : true;
                return (
                  <label key={d._id} style={{ ...muted, border: '1px solid var(--border)', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', background: on ? 'var(--accent-dim)' : 'transparent' }}>
                    <input type="checkbox" checked={on} style={{ marginRight: 6 }} onChange={() => {
                      const base = picked || readable.map((x) => x._id);
                      setPicked(on ? base.filter((id) => id !== d._id) : [...base, d._id]);
                    }} />
                    {d.filename}
                  </label>
                );
              })}
              {readable.length === 0 && <span style={muted}>Upload and process sources first.</span>}
            </div>
            <button className="btn btn-primary" style={{ marginTop: 14 }} disabled={busy || !form.title.trim() || readable.length === 0} onClick={create}>Generate report</button>
          </div>

          <p style={h2}>Reports</p>
          {drafts.length === 0 && <p style={muted}>None yet.</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {drafts.map((d) => (
              <div key={d.id} style={{ ...card, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }} onClick={() => { load(d.id); if (d.status === 'GENERATING') watch(d.id); }}>
                <b style={{ color: 'var(--text)' }}>{d.title}</b>
                <span style={muted}>{d.status === 'READY' ? `${d.stats.supported + d.stats.conflicted} verified · v${d.version}` : d.status === 'GENERATING' ? `${d.progress?.phase || 'starting'}…` : d.error}</span>
                <span style={{ marginLeft: 'auto' }}><ClassificationBadge level={d.classification} /></span>
              </div>
            ))}
          </div>
        </>
      )}

      {open && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <button className="btn btn-ghost" onClick={() => { clearInterval(pollRef.current); setOpen(null); setVerifyResult(null); refreshList(); }}>← All reports</button>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>{open.title}</h2>
            <ClassificationBadge level={open.classification} />
            <span style={muted}>v{open.version}</span>
            <button className="btn btn-ghost" style={{ marginLeft: 'auto', fontSize: 12 }} onClick={() => run(async () => { await deleteDraft(projectId, open.id); setOpen(null); refreshList(); })}>Delete report</button>
          </div>

          {open.status === 'GENERATING' && <div style={card}><span className="spinner" style={{ width: 14, height: 14, marginRight: 8 }} />{open.progress?.phase || 'Starting'} ({open.progress?.done || 0}/{open.progress?.total || '…'})</div>}
          {open.status === 'ERROR' && <div style={{ ...card, borderColor: 'var(--error)' }}><b style={{ color: 'var(--error)' }}>Generation failed.</b> <span style={muted}>{open.error}</span></div>}

          {open.status === 'READY' && (
            <>
              <div style={{ ...card, display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
                <span><b>{stats.supported}</b> <span style={muted}>verified</span></span>
                <span><b style={{ color: '#a3211f' }}>{stats.conflicted}</b> <span style={muted}>in conflict</span></span>
                <span><b>{stats.unsupported}</b> <span style={muted}>unverified (kept out of exports)</span></span>
                <span><b>{open.rejected}</b> <span style={muted}>rejected at generation</span></span>
                <span><b>{Math.round((stats.editRate || 0) * 100)}%</b> <span style={muted}>human edit rate</span></span>
                {open.redacted > 0 && <span style={{ color: '#8a6200', fontSize: 12 }}>{open.redacted} statement(s) hidden: above your clearance</span>}
              </div>

              <div style={{ display: 'flex', gap: 6, margin: '14px 0 4px' }}>
                {[['document', 'Document'], ['review', 'Review statements']].map(([k, label]) => (
                  <button key={k} type="button" className={view === k ? 'btn btn-primary' : 'btn btn-ghost'} style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => setView(k)}>{label}</button>
                ))}
                <span style={{ ...muted, alignSelf: 'center', marginLeft: 6 }}>{view === 'document' ? 'Reads like the exported report.' : 'Edit or delete single statements and see their evidence.'}</span>
              </div>

              {view === 'document' && <div style={{ marginTop: 10 }}><ReportDocument draft={open} documents={documents} templateLabel={(templates.find((t) => t.key === open.template) || {}).label} /></div>}

              {view === 'review' && open.sections.map((s) => (
                <div key={s.key}>
                  <p style={h2}>{s.heading}</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {s.claims.length === 0 && s.redacted === 0 && <p style={muted}>No verifiable statements for this section.</p>}
                    {s.claims.map((c) => (
                      <ClaimRow key={c.id} claim={c} sources={sources} busy={busy}
                        onEdit={(id, text) => claimAction(() => editDraftClaim(projectId, open.id, id, text))}
                        onDelete={(id) => claimAction(() => deleteDraftClaim(projectId, open.id, id))} />
                    ))}
                    {s.redacted > 0 && <p style={{ ...muted, fontStyle: 'italic' }}>[{s.redacted} statement(s) above your clearance are hidden]</p>}
                  </div>
                </div>
              ))}

              <p style={h2}>Add an analyst note</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <select style={input} value={note.sectionKey || open.sections[0].key} onChange={(e) => setNote({ ...note, sectionKey: e.target.value })}>
                  {open.sections.map((s) => <option key={s.key} value={s.key}>{s.heading}</option>)}
                </select>
                <input style={{ ...input, flex: 1, minWidth: 220 }} placeholder="Text (shown in exports as an unsourced analyst note)" value={note.text} onChange={(e) => setNote({ ...note, text: e.target.value })} />
                <button className="btn btn-ghost" disabled={busy || !note.text.trim()} onClick={() => claimAction(async () => { await addDraftClaim(projectId, open.id, { sectionKey: note.sectionKey || open.sections[0].key, text: note.text }); setNote({ sectionKey: '', text: '' }); })}>Add note</button>
              </div>

              <p style={h2}>Export</p>
              <div style={card}>
                <p style={muted}>Creates a PDF and a signed provenance manifest at your clearance level. Statements above it are redacted; unverified statements are left out.</p>
                <label style={{ ...muted, display: 'block', marginTop: 8 }}><input type="checkbox" checked={includeUnverified} onChange={(e) => setIncludeUnverified(e.target.checked)} style={{ marginRight: 6 }} />Include unverified statements, clearly labelled</label>
                <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={busy} onClick={doExport}>Export signed PDF + manifest</button>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
                  {exportsList.map((e) => (
                    <div key={e.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', ...muted }}>
                      <ClassificationBadge level={e.classification} />
                      <span>v{e.draftVersion} · {new Date(e.createdAt).toLocaleString()} · {e.pages} pages</span>
                      <button className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => downloadFile(e.pdfUrl, 'document.pdf')}>PDF</button>
                      <button className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => downloadFile(e.manifestUrl, 'manifest.json')}>Manifest</button>
                    </div>
                  ))}
                </div>
              </div>

              <p style={h2}>Verify an export</p>
              <VerifyBox onVerify={check} result={verifyResult} busy={busy} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function VerifyBox({ onVerify, result, busy }) {
  const [manifest, setManifest] = useState(null);
  const [pdf, setPdf] = useState(null);
  return (
    <div style={card}>
      <p style={muted}>Checks the signature, the PDF, the audit trail and every source file and passage against what is stored now. Changing a single byte of any of them makes this fail.</p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
        <label style={muted}>manifest.json <input type="file" accept=".json" onChange={(e) => setManifest(e.target.files[0])} /></label>
        <label style={muted}>document.pdf (optional) <input type="file" accept=".pdf" onChange={(e) => setPdf(e.target.files[0])} /></label>
        <button className="btn btn-primary" disabled={!manifest || busy} onClick={() => onVerify(manifest, pdf)}>Verify</button>
      </div>
      {result && (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontWeight: 700, color: result.valid ? '#2f6b3b' : '#a3211f' }}>
            {result.valid ? '✓ Valid' : '✗ Verification failed'}{result.valid && !result.complete ? ' (some checks skipped: not authorised to read those sources)' : ''}
          </p>
          <ul style={{ marginTop: 6, fontSize: 12 }}>
            {result.checks.map((c, i) => (
              <li key={i} style={{ color: c.skipped ? 'var(--text-dim)' : c.ok ? '#2f6b3b' : '#a3211f' }}>
                {c.skipped ? '–' : c.ok ? '✓' : '✗'} {c.name} <span style={{ color: 'var(--text-dim)' }}>{c.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
