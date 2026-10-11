import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import ClassificationBadge from './ClassificationBadge';
import { describeLocation } from '../locations';
import { describeScope } from './ChatScope';

const chipStyle = {
  display: 'inline-block', minWidth: 16, padding: '0 5px', margin: '0 1px', fontSize: 10.5, fontWeight: 700, lineHeight: '16px',
  borderRadius: 8, border: '1px solid var(--border-strong, #c9c0b8)', background: 'var(--surface)', color: 'var(--text-dim)',
  cursor: 'pointer', verticalAlign: 'baseline',
};

// "[1][2]" in the answer becomes small clickable chips that jump to the numbered source beside the answer.
const withCitationLinks = (text) => text.replace(/\[(\d+)\]/g, (m, n) => `[${n}](#cite-${n})`);

/**
 * One assistant answer: explanatory Markdown with inline citation chips, the passages it was written from, and the
 * notes that matter for trust (what was searched for, how many sentences the sources could not confirm).
 */
export default function ChatAnswer({ msg, compact = false, onOpenSource }) {
  const [active, setActive] = useState(null);
  const [open, setOpen] = useState({});
  const sources = msg.sources || [];
  const cardId = (n) => `src-${msg.id || 'a'}-${n}`;

  const jump = (n) => {
    setActive(n);
    setOpen((o) => ({ ...o, [n]: true }));
    const el = document.getElementById(cardId(n));
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const components = {
    p: ({ children }) => <p style={{ margin: '0 0 8px' }}>{children}</p>,
    ul: ({ children }) => <ul style={{ margin: '0 0 8px', paddingLeft: 18, listStyle: 'disc' }}>{children}</ul>,
    ol: ({ children }) => <ol style={{ margin: '0 0 8px', paddingLeft: 18, listStyle: 'decimal' }}>{children}</ol>,
    li: ({ children }) => <li style={{ marginBottom: 3 }}>{children}</li>,
    a: ({ href, children }) => {
      const m = /^#cite-(\d+)$/.exec(href || '');
      if (!m) return <a href={href} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>{children}</a>;
      const n = Number(m[1]);
      return (
        <button type="button" data-testid="citation-chip" title={sources[n - 1] ? `${sources[n - 1].filename} · ${describeLocation(sources[n - 1].loc)}` : ''} onClick={() => jump(n)}
          style={{ ...chipStyle, background: active === n ? 'var(--accent)' : chipStyle.background, color: active === n ? '#fff' : chipStyle.color }}>
          {n}
        </button>
      );
    },
  };

  return (
    <div>
      {msg.rewritten && (
        <p data-testid="answer-rewritten" style={{ fontSize: 11, color: 'var(--text-dim)', margin: '0 0 6px' }}>
          Searched for: <i>{msg.rewritten}</i>
        </p>
      )}
      <ReactMarkdown components={components}>{withCitationLinks(msg.content || '')}</ReactMarkdown>

      {msg.grounding?.unconfirmed > 0 && (
        <p data-testid="answer-unconfirmed" style={{ fontSize: 11, color: '#8a6200', marginTop: 4 }}>
          ⚠ {msg.grounding.unconfirmed} statement{msg.grounding.unconfirmed > 1 ? 's' : ''} could not be confirmed by the cited source{msg.grounding.unconfirmed > 1 ? 's' : ''}. Check {msg.grounding.unconfirmed > 1 ? 'them' : 'it'} against the passage{msg.grounding.unconfirmed > 1 ? 's' : ''} below.
        </p>
      )}
      {msg.mode === 'general' && (
        <p data-testid="answer-general" style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic', marginTop: 6 }}>General answer, not from your documents.</p>
      )}
      {msg.scope && ['documents'].includes(msg.mode) && (
        <p data-testid="answer-scope" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>Scope: {describeScope(msg.scope)}</p>
      )}

      {sources.length > 0 && (
        <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <p style={{ color: 'var(--text-dim)', fontSize: 10.5, marginBottom: 5, fontWeight: 700, letterSpacing: '0.06em' }}>SOURCES</p>
          {sources.map((s) => {
            const expanded = open[s.n];
            const long = (s.text || '').length > 260;
            return (
              <div key={s.n} id={cardId(s.n)} data-testid="source-card" style={{
                fontSize: 11.5, color: 'var(--text-dim)', marginBottom: 6, padding: '6px 9px', borderRadius: 8,
                background: 'var(--surface)', border: `1px solid ${active === s.n ? 'var(--accent)' : 'var(--border)'}`,
              }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <b style={{ color: 'var(--text)' }}>[{s.n}]</b>
                  <span style={{ color: 'var(--text)' }}>{s.filename}</span>
                  <span>· {describeLocation(s.loc)}</span>
                  <ClassificationBadge level={s.classification} />
                  {onOpenSource && (
                    <button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto', fontSize: 10.5, padding: '1px 7px' }} onClick={() => onOpenSource(s)}>Open document</button>
                  )}
                </div>
                <div style={{ fontStyle: 'italic', marginTop: 4, lineHeight: 1.5 }}>
                  “{expanded || !long ? s.text : `${s.text.slice(0, 260)}…`}”
                  {long && (
                    <button type="button" onClick={() => setOpen((o) => ({ ...o, [s.n]: !expanded }))} style={{ marginLeft: 6, fontStyle: 'normal', textDecoration: 'underline', cursor: 'pointer', background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 11 }}>
                      {expanded ? 'less' : 'more'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const historyFrom = (messages) => messages
  .filter((m) => !m.isError && !m.intro && m.content)
  .slice(-8)
  .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));
