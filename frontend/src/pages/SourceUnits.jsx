import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { getDocument, listUnits, downloadFile } from '../api';
import ClassificationBadge from '../components/ClassificationBadge';
import UserMenu from '../components/UserMenu';
import { SOURCE_TYPES } from '../classification';
import { describeLocation } from '../locations';

const PAGE_SIZE = 100;

function Chip({ children, tone = 'neutral' }) {
  const tones = {
    neutral: { color: 'var(--text-dim)', background: 'var(--surface3)' },
    warn: { color: '#8a6200', background: 'rgba(200,150,0,0.14)' },
    bad: { color: 'var(--error)', background: 'rgba(190,40,36,0.10)' },
  };
  return (
    <span className="text-[11px] font-semibold px-2 py-[2px] rounded-md whitespace-nowrap" style={tones[tone]}>
      {children}
    </span>
  );
}

export default function SourceUnits() {
  const { projectId, documentId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const focus = Number(searchParams.get('focus')) || null; // ordinal of a unit to scroll to (from a conflict or entity link)
  const [doc, setDoc] = useState(null);
  const [data, setData] = useState({ units: [], total: 0 });
  const [skip, setSkip] = useState(focus ? Math.floor((focus - 1) / PAGE_SIZE) * PAGE_SIZE : 0);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all'); // all | raw | lowConfidence
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDocument(documentId, projectId).then((r) => setDoc(r.data)).catch(() => setError('Source not found'));
  }, [documentId, projectId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { skip, limit: PAGE_SIZE };
      if (q.trim()) params.q = q.trim();
      if (filter === 'raw') params.raw = true;
      if (filter === 'lowConfidence') params.lowConfidence = true;
      setData((await listUnits(projectId, documentId, params)).data);
      setError('');
    } catch (e) {
      setError(e.response?.data?.error || 'Could not load units');
    } finally {
      setLoading(false);
    }
  }, [projectId, documentId, skip, q, filter]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0); // debounce typing
    return () => clearTimeout(t);
  }, [load, q]);

  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    setSkip(0);
  }, [q, filter]);

  useEffect(() => {
    if (focus && data.units.some((u) => u.ordinal === focus)) {
      document.getElementById(`unit-${focus}`)?.scrollIntoView({ block: 'center' });
    }
  }, [data, focus]);

  const filters = [['all', 'All'], ['raw', 'Unparsed lines']].concat(doc?.ocrConfidence != null ? [['lowConfidence', 'Low OCR confidence']] : []);

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <nav className="navbar">
        <span className="navbar-brand cursor-pointer" onClick={() => navigate('/')}>Mirage</span>
        <span className="navbar-sep">/</span>
        <span className="cursor-pointer text-[15px]" style={{ color: 'var(--text-dim)' }} onClick={() => navigate(`/projects/${projectId}`)}>Project</span>
        <span className="navbar-sep">/</span>
        <span className="text-[16px] font-semibold truncate" style={{ color: 'var(--text)' }}>{doc?.filename || '…'}</span>
        <div className="ml-auto"><UserMenu /></div>
      </nav>

      <div className="max-w-[1000px] mx-auto px-8 py-8 pb-14">
        {doc && (
          <div className="mb-6">
            <div className="flex items-center gap-3 flex-wrap mb-2">
              <h1 className="text-[22px] font-bold" style={{ color: 'var(--text)' }}>{doc.filename}</h1>
              <ClassificationBadge level={doc.classification} />
              <Chip>{SOURCE_TYPES[doc.sourceType]?.label || doc.sourceType}</Chip>
              {doc.ocrConfidence != null && <Chip tone={doc.ocrConfidence < 60 ? 'warn' : 'neutral'}>OCR {doc.ocrConfidence}%</Chip>}
            </div>
            <p className="text-[12px] break-all" style={{ color: 'var(--text-dim)' }}>
              {doc.unitCount} evidence units · SHA-256 {doc.sha256}
            </p>
            {doc.warnings?.map((w) => <p key={w} className="text-[13px] mt-1" style={{ color: '#8a6200' }}>⚠ {w}</p>)}
            <div className="flex gap-2 mt-3">
              {doc.annotatedFileUrl && (
                <button className="btn btn-ghost" onClick={() => navigate(`/projects/${projectId}/documents/${documentId}`)}>Open annotated PDF</button>
              )}
              <button className="btn btn-ghost" onClick={() => downloadFile(doc.fileUrl, doc.filename)}>Download original</button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search units…"
            className="flex-1 min-w-[220px]"
            style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '9px 14px', background: 'var(--surface)', color: 'var(--text)', fontSize: 14 }}
          />
          {filters.map(([key, label]) => (
            <button key={key} className={`btn ${filter === key ? 'btn-primary' : 'btn-ghost'}`} style={{ fontSize: 13 }} onClick={() => setFilter(key)}>{label}</button>
          ))}
        </div>

        {error && <p style={{ color: 'var(--error)' }}>{error}</p>}
        {!error && !loading && data.units.length === 0 && (
          <p style={{ color: 'var(--text-dim)' }}>No units match.</p>
        )}

        <div className="flex flex-col gap-2">
          {data.units.map((u) => (
            <div key={u._id} id={`unit-${u.ordinal}`} className="px-4 py-3 rounded-xl" style={{ border: u.ordinal === focus ? '2px solid var(--accent)' : '1px solid var(--border)', background: u.ordinal === focus ? 'var(--accent-dim)' : 'var(--surface)' }}>
              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                <Chip>#{u.ordinal}</Chip>
                <Chip>{describeLocation(u.loc)}</Chip>
                {u.loc?.ts && <Chip>{u.loc.ts.replace('T', ' ').replace('+00:00', ' UTC')}</Chip>}
                {u.loc?.eventId && !/^L\d+$/.test(u.loc.eventId) && <Chip>{u.loc.eventId}</Chip>}
                {u.parseStatus === 'raw' && <Chip tone="bad">unparsed</Chip>}
                {u.fields?.lowConfidence && <Chip tone="warn">low OCR confidence{u.confidence != null ? ` ${u.confidence}%` : ''}</Chip>}
              </div>
              <p className="text-[14px] whitespace-pre-wrap break-words" style={{ color: 'var(--text)', fontFamily: ['syslog'].includes(doc?.sourceType) ? 'ui-monospace, Menlo, monospace' : 'inherit' }}>
                {u.text}
              </p>
            </div>
          ))}
        </div>

        {data.total > PAGE_SIZE && (
          <div className="flex items-center justify-between mt-6">
            <button className="btn btn-ghost" disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - PAGE_SIZE))}>← Previous</button>
            <span className="text-[13px]" style={{ color: 'var(--text-dim)' }}>
              {skip + 1}–{Math.min(skip + PAGE_SIZE, data.total)} of {data.total}
            </span>
            <button className="btn btn-ghost" disabled={skip + PAGE_SIZE >= data.total} onClick={() => setSkip(skip + PAGE_SIZE)}>Next →</button>
          </div>
        )}
      </div>
    </div>
  );
}
