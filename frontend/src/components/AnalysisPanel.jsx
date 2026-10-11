import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  runAnalysis, getAnalysisStatus, listEntities, decideEntities,
  listConflicts, reviewConflict, listDuplicates, listGaps,
} from '../api';
import ClassificationBadge from './ClassificationBadge';
import { describeLocation } from '../locations';

const card = { border: '1px solid var(--border)', background: 'var(--surface)', borderRadius: 16, padding: '16px 20px' };
const muted = { color: 'var(--text-dim)', fontSize: 12 };
const h2 = { fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-dim)', margin: '28px 0 12px' };

function Side({ side, projectId, label }) {
  const navigate = useNavigate();
  return (
    <div style={{ flex: 1, minWidth: 240, padding: '10px 12px', borderRadius: 10, background: 'var(--surface2)', border: '1px solid var(--border)' }}>
      <p style={{ ...muted, marginBottom: 4 }}>
        <b>{label}</b> · {side.filename} · {describeLocation(side.loc)} <ClassificationBadge level={side.classification} />
      </p>
      <p style={{ fontSize: 14, fontStyle: 'italic', color: 'var(--text)' }}>“{side.quote}”</p>
      {side.value && <p style={{ ...muted, marginTop: 4 }}>says: <b>{side.value}</b></p>}
      <button className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px', marginTop: 6 }}
        onClick={() => navigate(`/projects/${projectId}/documents/${side.documentId}/units?focus=${side.ordinal}`)}>
        Open in source
      </button>
    </div>
  );
}

export default function AnalysisPanel({ projectId }) {
  const [status, setStatus] = useState(null);
  const [conflicts, setConflicts] = useState([]);
  const [entities, setEntities] = useState({ entities: [], possible: [] });
  const [dups, setDups] = useState([]);
  const [gaps, setGaps] = useState([]);
  const [filter, setFilter] = useState('open');
  const [openEntity, setOpenEntity] = useState(null);
  const [error, setError] = useState('');
  const pollRef = useRef(null);
  const running = status?.status === 'RUNNING';

  const loadResults = useCallback(async () => {
    try {
      const [c, e, d, g] = await Promise.all([listConflicts(projectId), listEntities(projectId), listDuplicates(projectId), listGaps(projectId)]);
      setConflicts(c.data); setEntities(e.data); setDups(d.data); setGaps(g.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load results');
    }
  }, [projectId]);

  const refreshStatus = useCallback(async () => {
    const { data } = await getAnalysisStatus(projectId);
    setStatus(data);
    return data.status;
  }, [projectId]);

  useEffect(() => {
    refreshStatus().then(loadResults).catch(() => setError('Could not load analysis'));
    return () => clearInterval(pollRef.current);
  }, [refreshStatus, loadResults]);

  const poll = () => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const s = await refreshStatus();
      if (s !== 'RUNNING') { clearInterval(pollRef.current); loadResults(); }
    }, 2000);
  };
  useEffect(() => { if (running) poll(); }, [running]); // eslint-disable-line

  const start = async () => {
    setError('');
    try {
      await runAnalysis(projectId);
      await refreshStatus();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not start analysis');
    }
  };

  const review = async (id, next) => {
    await reviewConflict(projectId, id, next);
    setConflicts((prev) => prev.map((c) => (c.id === id ? { ...c, status: next } : c)));
  };

  const decide = async (p, decision) => {
    const { data } = await decideEntities(projectId, p.keyA, p.keyB, decision);
    setEntities(data);
  };

  const shown = conflicts.filter((c) => filter === 'all' || c.status === filter);
  const pct = status?.total ? Math.round((status.done / status.total) * 100) : 0;

  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <p style={{ fontWeight: 700, color: 'var(--text)', fontSize: 16 }}>Cross-source analysis</p>
          <p style={muted}>
            Finds the same people, systems and IDs across sources, links duplicates, and compares the values sources state
            (times, counts, durations) to find contradictions. Only material within your clearance is analysed.
          </p>
          {running && <p style={{ ...muted, marginTop: 6 }}>{status.phase}… {status.total ? `${status.done}/${status.total} (${pct}%)` : ''}</p>}
          {status?.status === 'DONE' && status.stats?.factsCompared != null && (
            <p style={{ ...muted, marginTop: 6 }}>
              Last run: compared {status.stats.factsCompared} stated facts across sources, found {status.stats.conflictsFound} conflict{status.stats.conflictsFound === 1 ? '' : 's'}.
              {status.stats.logEventsLabelled > 0 && ` ${status.stats.logEventsLabelled} log events matched a milestone.`}
              {status.stats.incomplete && ' The language model was too slow for part of this run (it is busy or the machine is short of memory); what was read is kept, run the analysis again to continue.'}
              {(status.stats.entityUnitsPending > 0 || status.stats.factUnitsPending > 0) && ` Long documents are read in stages: ${status.stats.entityUnitsPending || 0} passages for names and ${status.stats.factUnitsPending || 0} for stated values are still waiting. Run the analysis again to continue.`}
              {status.stats.logEventsPending > 0 && ` ${status.stats.logEventsPending} more log events will be read on the next run.`}
            </p>
          )}
          {status?.status === 'ERROR' && <p style={{ color: 'var(--error)', fontSize: 13, marginTop: 6 }}>Last run failed: {status.error}</p>}
          {error && <p style={{ color: 'var(--error)', fontSize: 13, marginTop: 6 }}>{error}</p>}
        </div>
        <button className="btn btn-primary" disabled={running} onClick={start}>{running ? 'Analysing…' : status?.status === 'DONE' ? 'Re-run analysis' : 'Run analysis'}</button>
      </div>

      <details style={{ ...card, marginTop: 10, fontSize: 13 }} data-testid="analysis-help">
        <summary style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--text)' }}>What does Analysis give me?</summary>
        <div style={{ ...muted, fontSize: 13, lineHeight: 1.65, marginTop: 8 }}>
          <p>Analysis compares everything you uploaded and answers questions a chat cannot: <i>do my sources agree, and who or what do they mention?</i> It reads each source once; the comparing itself is done by plain code, so every result is reproducible and shows the exact quotes behind it.</p>
          <ul style={{ margin: '8px 0 0 18px' }}>
            <li><b>Conflicts between sources.</b> Two sources state different values for the same thing, such as an outage that ended at 20:00 in the report and 20:28 in the chat. Each conflict shows both quotes and links to the passage; you can confirm or dismiss it.</li>
            <li><b>Entities.</b> The people, systems, hosts, IDs and organisations mentioned, with different spellings of the same one merged ("R. Tanaka" and "Rahul Tanaka"). Possible merges are offered for you to accept or split.</li>
            <li><b>Duplicates.</b> Passages that appear word for word in more than one source.</li>
            <li><b>Values not compared.</b> Numbers or times a source states that the system could not match to anything, so you know what was skipped rather than silently ignored.</li>
          </ul>
          <p style={{ marginTop: 8 }}>The Report tab reuses these conflicts, and the Graph tab (Entities and conflicts) draws them. Long documents are read in stages; run the analysis again to continue.</p>
        </div>
      </details>

      <p style={h2}>Conflicts between sources · {conflicts.length}</p>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {['open', 'confirmed', 'dismissed', 'all'].map((f) => (
          <button key={f} className={`btn ${filter === f ? 'btn-primary' : 'btn-ghost'}`} style={{ fontSize: 12 }} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>
      {shown.length === 0 && <p style={muted}>{conflicts.length ? 'No conflicts with this status.' : 'No conflicts found yet. Run the analysis after sources finish processing.'}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {shown.map((c) => (
          <div key={c.id} style={{ ...card, borderLeft: '4px solid #ef4444', opacity: c.status === 'dismissed' ? 0.6 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <b style={{ color: 'var(--text)' }}>{c.field || 'Disagreement'}</b>
              <span style={muted}>{c.kind}{c.supportA + c.supportB > 2 ? ` · ${c.supportA} vs ${c.supportB} supporting units` : ''}</span>
              <ClassificationBadge level={c.classification} />
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                {c.status !== 'confirmed' && <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => review(c.id, 'confirmed')}>Confirm</button>}
                {c.status !== 'dismissed' && <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => review(c.id, 'dismissed')}>Dismiss</button>}
                {c.status !== 'open' && <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => review(c.id, 'open')}>Reopen</button>}
              </span>
            </div>
            {c.explanation && <p style={{ fontSize: 13, color: 'var(--text)', marginBottom: 10 }}>{c.explanation}</p>}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Side side={c.a} projectId={projectId} label="Source A" />
              <Side side={c.b} projectId={projectId} label="Source B" />
            </div>
          </div>
        ))}
      </div>

      {entities.possible.length > 0 && (
        <>
          <p style={h2}>Possible matches · needs your decision</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {entities.possible.map((p) => (
              <div key={p.keyA + p.keyB} style={{ ...card, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px' }}>
                <span style={{ color: 'var(--text)', fontWeight: 600 }}>{p.a.canonical}</span>
                <span style={muted}>?=</span>
                <span style={{ color: 'var(--text)', fontWeight: 600 }}>{p.b.canonical}</span>
                <span style={muted}>{p.reason}</span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => decide(p, 'merge')}>Same</button>
                  <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => decide(p, 'split')}>Different</button>
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <p style={h2}>Entities · {entities.entities.length}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {entities.entities.slice(0, 80).map((e) => (
          <div key={e.id} style={{ ...card, padding: '10px 16px', cursor: 'pointer' }} onClick={() => setOpenEntity(openEntity === e.id ? null : e.id)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <b style={{ color: 'var(--text)' }}>{e.canonical}</b>
              <span style={muted}>{e.type}</span>
              <span style={muted}>{e.mentionCount} mention{e.mentionCount > 1 ? 's' : ''} · {e.docIds.length} source{e.docIds.length > 1 ? 's' : ''}</span>
              <ClassificationBadge level={e.classification} />
            </div>
            {e.aliases.length > 1 && <p style={{ ...muted, marginTop: 4 }}>Also written: {e.aliases.filter((a) => a !== e.canonical).join(' · ')}</p>}
            {openEntity === e.id && (
              <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 12, color: 'var(--text-dim)' }}>
                {e.mentions.slice(0, 30).map((m, i) => <li key={i}>“{m.text}”</li>)}
              </ul>
            )}
          </div>
        ))}
        {entities.entities.length === 0 && <p style={muted}>No entities yet.</p>}
      </div>

      {gaps.length > 0 && (
        <>
          <p style={h2}>Not compared · {gaps.length} unit{gaps.length === 1 ? '' : 's'}</p>
          <p style={{ ...muted, marginBottom: 8 }}>These units state times, dates or counts that could not be turned into a comparable fact, so they were not checked for conflicts. Review them by hand.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {gaps.map((g) => (
              <div key={g.unitId} style={{ ...card, padding: '10px 16px' }}>
                <p style={{ ...muted, marginBottom: 4 }}>{g.filename} · {describeLocation(g.loc)} · values: <b>{g.values.join(', ')}</b></p>
                <p style={{ fontSize: 13, color: 'var(--text)' }}>{g.text}</p>
              </div>
            ))}
          </div>
        </>
      )}

      <p style={h2}>Duplicates · {dups.length} group{dups.length === 1 ? '' : 's'}</p>
      {dups.length === 0 && <p style={muted}>No duplicated content found.</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {dups.map((g, i) => (
          <div key={i} style={{ ...card, padding: '10px 16px' }}>
            <p style={{ ...muted, marginBottom: 4 }}>{g.count} copies · {g.documents} source{g.documents > 1 ? 's' : ''} · {g.kind}</p>
            <p style={{ fontSize: 13, color: 'var(--text)' }}>{g.text}</p>
            <p style={{ ...muted, marginTop: 4 }}>{g.units.slice(0, 6).map((u) => `${u.filename} (${describeLocation(u.loc)})`).join(' · ')}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
