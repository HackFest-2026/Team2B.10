import React from 'react';
import ClassificationBadge from './ClassificationBadge';

const paper = { background: '#fff', border: '1px solid var(--border)', borderRadius: 14, padding: '36px 44px', boxShadow: '0 6px 20px rgba(55,50,47,0.06)', color: '#1d1b19' };
const h2 = { fontSize: 17, fontWeight: 700, margin: '26px 0 8px', paddingBottom: 4, borderBottom: '1px solid #d9d1ca' };
const meta = { color: '#6b625b', fontSize: 12.5 };

// The report as a document: numbered sections in running prose, numbered source citations, a reference list.
// Statements keep their verification state: unverified ones are greyed, conflicting ones marked.
export default function ReportDocument({ draft, documents, templateLabel }) {
  const refs = [];
  const numberOf = new Map();
  const cite = (e) => {
    const key = String(e.unitId);
    if (!numberOf.has(key)) {
      const doc = documents.find((d) => d._id === e.documentId);
      numberOf.set(key, refs.length + 1);
      refs.push({ n: refs.length + 1, filename: doc ? doc.filename : 'source', quote: e.quote });
    }
    return numberOf.get(key);
  };

  const sections = draft.sections.map((s) => ({
    ...s,
    claims: s.claims.map((c) => ({ ...c, cites: [...new Set(c.evidence.map(cite))] })),
  }));
  const stats = draft.stats || {};
  const files = [...new Set(refs.map((r) => r.filename))];

  const statement = (c) => (
    <span key={c.id} style={{
      color: c.status === 'unsupported' ? '#6b625b' : 'inherit',
      fontStyle: c.status === 'unsupported' ? 'italic' : 'normal',
      borderBottom: c.status === 'conflicted' ? '2px solid rgba(190,40,36,0.45)' : 'none',
    }}>
      {c.text}
      {c.cites.length > 0 && <sup style={{ fontSize: 10, marginLeft: 1 }}>[{c.cites.join(', ')}]</sup>}
      {c.status === 'unsupported' && <span style={{ fontSize: 10.5, fontStyle: 'normal', fontWeight: 700, color: '#6b625b' }}> (unverified)</span>}
      {c.status === 'human' && <span style={{ fontSize: 10.5, fontWeight: 700, color: '#8a6200' }}> (analyst note)</span>}
      {' '}
    </span>
  );

  return (
    <article style={paper} data-testid="report-document">
      <h1 style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.2 }}>{draft.title}</h1>
      <p style={{ ...meta, marginTop: 6 }}>
        {templateLabel && <>{templateLabel} · </>}
        Prepared {draft.generatedAt ? new Date(draft.generatedAt).toLocaleString() : ''} · <ClassificationBadge level={draft.classification} /> · version {draft.version}
      </p>
      <table style={{ ...meta, margin: '12px 0 4px', borderCollapse: 'collapse' }}>
        <tbody>
          <tr><td style={{ paddingRight: 16, verticalAlign: 'top' }}>Sources</td><td style={{ color: '#1d1b19' }}>{files.join(', ') || '—'}</td></tr>
          <tr><td style={{ paddingRight: 16, verticalAlign: 'top' }}>Verification</td><td style={{ color: '#1d1b19' }}>{stats.supported || 0} verified · {stats.conflicted || 0} in conflict · {stats.unsupported || 0} unverified (left out of exports)</td></tr>
        </tbody>
      </table>

      {sections.map((s, i) => (
        <section key={s.key}>
          <h2 style={h2}>{i + 1}. {s.heading}</h2>
          {s.key === 'scope' && draft.coverage && (
            <>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }} data-testid="coverage-table">
                <thead><tr style={{ textAlign: 'left', ...meta }}><th>Document</th><th>Type</th><th>Classification</th><th>Units</th></tr></thead>
                <tbody>
                  {draft.coverage.documents.map((d) => (
                    <tr key={d.id} style={{ borderTop: '1px solid #ece6e0' }}><td style={{ padding: '6px 0' }}>{d.filename}</td><td>{d.sourceType}</td><td><ClassificationBadge level={d.classification} /></td><td>{d.units}</td></tr>
                  ))}
                </tbody>
              </table>
              {draft.coverage.hiddenDocuments > 0 && <p style={{ ...meta, fontStyle: 'italic' }}>[{draft.coverage.hiddenDocuments} document(s) above your clearance are hidden]</p>}
            </>
          )}
          {s.key === 'gaps' && draft.coverage && (
            <>
              <p style={{ fontSize: 15, lineHeight: 1.7 }}>{draft.coverage.gaps.total} passage(s) state times, counts or dates that were not matched to any other source, so they could not be compared.</p>
              <ul style={{ fontSize: 14, margin: 0, paddingLeft: 20 }}>{draft.coverage.gaps.examples.map((g, k) => <li key={k}><b>{g.filename}</b>: {g.text}</li>)}</ul>
            </>
          )}
          {s.key === 'provenance' && (
            <p style={{ fontSize: 15, lineHeight: 1.7 }}>Every numbered citation below maps a statement to its exact source passage. Exporting a signed PDF adds the manifest with passage and file hashes and the signature.</p>
          )}
          {s.claims.length === 0 && !s.redacted && !['scope', 'gaps', 'provenance'].includes(s.key) && <p style={{ ...meta, fontStyle: 'italic' }}>No verifiable statements for this section.</p>}
          {s.key === 'conflicts' && s.claims.length > 0 ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <tbody>
                {s.claims.map((c) => (
                  <tr key={c.id} style={{ borderBottom: '1px solid #ece6e0' }}>
                    <td style={{ padding: '8px 0' }}>{statement(c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            Array.from({ length: Math.ceil(s.claims.length / 3) }, (_, p) => (
              <p key={p} style={{ fontSize: 15, lineHeight: 1.7, margin: '0 0 10px' }}>{s.claims.slice(p * 3, p * 3 + 3).map(statement)}</p>
            ))
          )}
          {s.redacted > 0 && <p style={{ ...meta, fontStyle: 'italic' }}>[{s.redacted} statement(s) above your clearance are hidden]</p>}
        </section>
      ))}

      {refs.length > 0 && (
        <section>
          <h2 style={h2}>Sources cited</h2>
          <ol style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 13 }}>
            {refs.map((r) => (
              <li key={r.n} style={{ marginBottom: 8 }}>
                <b>[{r.n}]</b> {r.filename}
                <div style={{ ...meta, fontStyle: 'italic' }}>“{r.quote}”</div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </article>
  );
}
