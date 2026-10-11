import React, { useState, useEffect, useRef, useCallback } from 'react';
import { generateProjectSummary, getProjectSummary } from '../api';
import ClassificationBadge from './ClassificationBadge';
import { describeLocation } from '../locations';
import './ProjectSummary.css';

/* ── Lightweight Markdown → JSX renderer ─────────────────────────────── */
function renderMarkdown(md) {
  if (!md) return null;
  const lines = md.split('\n');
  const elements = [];
  let listItems = [];
  let listKey = 0;

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`ul-${listKey++}`} className="summary-list">
          {listItems.map((li, i) => (
            <li key={i}>{inlineFormat(li)}</li>
          ))}
        </ul>
      );
      listItems = [];
    }
  };

  const inlineFormat = (text) => {
    // Bold + italic, bold, italic, inline code
    const parts = [];
    const regex = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
    let lastIndex = 0;
    let match;
    let key = 0;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }
      if (match[2]) parts.push(<strong key={key++}><em>{match[2]}</em></strong>);
      else if (match[3]) parts.push(<strong key={key++}>{match[3]}</strong>);
      else if (match[4]) parts.push(<em key={key++}>{match[4]}</em>);
      else if (match[5]) parts.push(<code key={key++} className="summary-inline-code">{match[5]}</code>);
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < text.length) parts.push(text.slice(lastIndex));
    return parts.length === 0 ? text : parts;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') {
      flushList();
      continue;
    }

    // Headings
    const h3 = trimmed.match(/^###\s+(.+)/);
    if (h3) { flushList(); elements.push(<h4 key={i} className="summary-h3">{inlineFormat(h3[1])}</h4>); continue; }

    const h2 = trimmed.match(/^##\s+(.+)/);
    if (h2) { flushList(); elements.push(<h3 key={i} className="summary-h2">{inlineFormat(h2[1])}</h3>); continue; }

    const h1 = trimmed.match(/^#\s+(.+)/);
    if (h1) { flushList(); elements.push(<h2 key={i} className="summary-h1">{inlineFormat(h1[1])}</h2>); continue; }

    // Horizontal rule
    if (/^---+$/.test(trimmed)) { flushList(); elements.push(<hr key={i} className="summary-hr" />); continue; }

    // Numbered list
    const numbered = trimmed.match(/^\d+\.\s+(.+)/);
    if (numbered) { listItems.push(numbered[1]); continue; }

    // Bullet list
    const bullet = trimmed.match(/^[-*]\s+(.+)/);
    if (bullet) { listItems.push(bullet[1]); continue; }

    // Regular paragraph
    flushList();
    elements.push(<p key={i} className="summary-p">{inlineFormat(trimmed)}</p>);
  }
  flushList();
  return elements;
}

/* ── Animated particles background ─────────────────────────────────── */
function FloatingOrbs() {
  return (
    <div className="summary-orbs" aria-hidden="true">
      {[...Array(6)].map((_, i) => (
        <div
          key={i}
          className="summary-orb"
          style={{
            '--delay': `${i * 1.4}s`,
            '--size': `${60 + i * 25}px`,
            '--x': `${10 + i * 15}%`,
            '--y': `${10 + (i % 3) * 30}%`,
          }}
        />
      ))}
    </div>
  );
}

/* ── Section icon mapping ────────────────────────────────────────── */
const sectionIcons = {
  'project overview': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
    </svg>
  ),
  'key themes': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
    </svg>
  ),
  'core findings': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
    </svg>
  ),
  'document breakdown': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  ),
  'connections': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
    </svg>
  ),
  'research gaps': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
    </svg>
  ),
};

function getSectionIcon(title) {
  const lower = title.toLowerCase();
  for (const [key, icon] of Object.entries(sectionIcons)) {
    if (lower.includes(key)) return icon;
  }
  return sectionIcons['project overview'];
}

/* ── Main Component ──────────────────────────────────────────────── */
export default function ProjectSummary({ projectId, projectName }) {
  const [summary, setSummary] = useState(null);
  const [sources, setSources] = useState([]);
  const [classification, setClassification] = useState(0);
  const [status, setStatus] = useState('NONE');
  const [error, setError] = useState('');
  const [generatedAt, setGeneratedAt] = useState(null);
  const [fadeIn, setFadeIn] = useState(false);
  const pollRef = useRef(null);
  const containerRef = useRef(null);

  const fetchSummary = useCallback(async () => {
    try {
      const { data } = await getProjectSummary(projectId);
      setSummary(data.summary);
      setSources(data.sources || []);
      setClassification(data.classification || 0);
      setStatus(data.status);
      setError(data.error || '');
      setGeneratedAt(data.generatedAt);
      return data.status;
    } catch {
      return 'ERROR';
    }
  }, [projectId]);

  useEffect(() => {
    fetchSummary().then((s) => {
      if (s === 'GENERATING') {
        pollRef.current = setInterval(async () => {
          const st = await fetchSummary();
          if (st !== 'GENERATING') {
            clearInterval(pollRef.current);
            setFadeIn(true);
          }
        }, 2000);
      } else if (s === 'DONE') {
        setFadeIn(true);
      }
    });
    return () => clearInterval(pollRef.current);
  }, [fetchSummary]);

  const handleGenerate = async () => {
    setStatus('GENERATING');
    setError('');
    try {
      await generateProjectSummary(projectId);
      pollRef.current = setInterval(async () => {
        const st = await fetchSummary();
        if (st !== 'GENERATING') {
          clearInterval(pollRef.current);
          setFadeIn(true);
        }
      }, 2000);
    } catch (err) {
      setStatus('ERROR');
      setError(err?.response?.data?.error || err.message);
    }
  };

  /* ── Summary exists but is above the caller's clearance ───── */
  if (status === 'WITHHELD') {
    return (
      <div className="summary-empty-state">
        <div className="summary-empty-inner">
          <h2 className="summary-empty-title">Summary withheld</h2>
          <p className="summary-empty-desc">
            This summary draws on material above your clearance. You can generate a new one from the sources you are cleared to read.
          </p>
          <button onClick={handleGenerate} className="summary-generate-btn">Generate for my clearance</button>
        </div>
      </div>
    );
  }

  /* ── No summary yet ─────────────────────────────────────────── */
  if (status === 'NONE' || (!summary && status !== 'GENERATING')) {
    return (
      <div className="summary-empty-state">
        <FloatingOrbs />
        <div className="summary-empty-inner">
          <div className="summary-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
            </svg>
          </div>
          <h2 className="summary-empty-title">Generate Project Summary</h2>
          <p className="summary-empty-desc">
            Analyze all documents in <strong>{projectName}</strong> to create a comprehensive
            overview of themes, findings, connections, and research gaps.
          </p>
          <button onClick={handleGenerate} className="summary-generate-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
            </svg>
            Generate Summary
          </button>
        </div>
      </div>
    );
  }

  /* ── Generating / loading ──────────────────────────────────── */
  if (status === 'GENERATING') {
    return (
      <div className="summary-loading-state">
        <FloatingOrbs />
        <div className="summary-loading-inner">
          <div className="summary-loading-ring">
            <div className="summary-loading-ring-inner" />
          </div>
          <h2 className="summary-loading-title">Synthesizing Intelligence</h2>
          <p className="summary-loading-desc">
            Analyzing all documents, extracting themes, and cross-referencing findings…
          </p>
          <div className="summary-loading-dots">
            <span /><span /><span />
          </div>
        </div>
      </div>
    );
  }

  /* ── Error ──────────────────────────────────────────────────── */
  if (status === 'ERROR') {
    return (
      <div className="summary-empty-state">
        <div className="summary-empty-inner">
          <div className="summary-empty-icon summary-error-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <h2 className="summary-empty-title" style={{ color: 'var(--error)' }}>Generation Failed</h2>
          <p className="summary-empty-desc">{error || 'Something went wrong. Please try again.'}</p>
          <button onClick={handleGenerate} className="summary-generate-btn">
            Retry
          </button>
        </div>
      </div>
    );
  }

  /* ── Summary content ───────────────────────────────────────── */
  const timeStr = generatedAt
    ? new Date(generatedAt).toLocaleString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit',
      })
    : null;

  // Parse summary into sections for card-based layout
  const sections = [];
  if (summary) {
    const lines = summary.split('\n');
    let currentSection = null;

    for (const line of lines) {
      const h2Match = line.trim().match(/^##\s+(.+)/);
      const h1Match = line.trim().match(/^#\s+(.+)/);

      if (h2Match || h1Match) {
        if (currentSection) sections.push(currentSection);
        const title = (h2Match || h1Match)[1].replace(/\*\*/g, '');
        currentSection = { title, content: '' };
      } else if (currentSection) {
        currentSection.content += line + '\n';
      } else {
        // Text before first heading → intro section
        if (line.trim()) {
          if (!currentSection) currentSection = { title: '', content: '' };
          currentSection.content += line + '\n';
        }
      }
    }
    if (currentSection) sections.push(currentSection);
  }

  return (
    <div ref={containerRef} className={`summary-container ${fadeIn ? 'summary-fade-in' : ''}`}>
      {/* Header */}
      <div className="summary-header">
        <div className="summary-header-content">
          <div className="summary-header-badge">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
            AI-Generated Summary
          </div>
          <h1 className="summary-title">{projectName}</h1>
          <p className="summary-subtitle">
            Comprehensive analysis across all project documents
          </p>
        </div>
        <div className="summary-header-actions">
          {timeStr && (
            <span className="summary-timestamp">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {timeStr}
            </span>
          )}
          <button onClick={handleGenerate} className="summary-refresh-btn" title="Regenerate summary">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
            </svg>
            Regenerate
          </button>
        </div>
      </div>

      {/* Sections as editorial cards */}
      <div className="summary-sections">
        {sections.map((section, idx) => (
          <div
            key={idx}
            className="summary-section-card"
            style={{ animationDelay: `${idx * 0.08}s` }}
          >
            {section.title && (
              <div className="summary-section-header">
                <div className="summary-section-icon">
                  {getSectionIcon(section.title)}
                </div>
                <h3 className="summary-section-title">{section.title}</h3>
                <div className="summary-section-num">{String(idx + 1).padStart(2, '0')}</div>
              </div>
            )}
            <div className="summary-section-body">
              {renderMarkdown(section.content)}
            </div>
          </div>
        ))}
      </div>

      {sources.length > 0 && (
        <div className="summary-section-card" style={{ marginTop: 16 }}>
          <div className="summary-section-header">
            <h3 className="summary-section-title">Sources</h3>
            <ClassificationBadge level={classification} />
          </div>
          <div className="summary-section-body" style={{ fontSize: 13 }}>
            {sources.map((src) => (
              <p key={src.n} style={{ marginBottom: 6 }}>
                <b>[{src.n}]</b> {src.filename} · {describeLocation(src.loc)} — <i>“{src.preview}”</i>
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
