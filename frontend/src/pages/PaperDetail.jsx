import React, { useState, useMemo } from 'react';
import { Link, useParams, Navigate } from 'react-router-dom';
import papers from '../data/papers';
import UserMenu from '../components/UserMenu';

const DIFFICULTY_STYLES = {
  beginner: { bg: '#edf8f2', color: '#2D6A4F', border: '#9dd4b5' },
  intermediate: { bg: '#fdf6e3', color: '#92600A', border: '#e9c97a' },
  advanced: { bg: '#fdf2f2', color: '#9b2020', border: '#eea8a8' },
};

const CATEGORY_COLORS = {
  NLP: '#3B82F6',
  Vision: '#8B5CF6',
  Generative: '#F59E0B',
  Basics: '#10B981',
  Sequence: '#EC4899',
};

function CodeBlock({ code, label }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }}>
      {/* Header bar */}
      <div
        className="flex items-center justify-between px-4 py-2"
        style={{ background: 'var(--surface3)', borderBottom: '1px solid var(--border)' }}
      >
        <span className="text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: 'var(--text-dim)' }}>
          {label}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-md transition-all"
          style={{
            color: copied ? '#2D6A4F' : 'var(--text-dim)',
            background: copied ? '#edf8f2' : 'transparent',
          }}
        >
          {copied ? (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
              </svg>
              Copy
            </>
          )}
        </button>
      </div>
      {/* Code body */}
      <pre
        className="overflow-x-auto p-4 text-[13px] leading-relaxed"
        style={{
          background: '#1E1E1E',
          color: '#D4D4D4',
          fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
          margin: 0,
        }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

function StepCard({ step, index, isActive, onClick, isCompleted }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left transition-all"
      style={{
        padding: '14px 16px',
        borderRadius: 12,
        border: `1.5px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
        background: isActive ? 'var(--surface)' : isCompleted ? 'var(--surface2)' : 'transparent',
        boxShadow: isActive ? '0 2px 12px rgba(55,50,47,0.08)' : 'none',
      }}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[12px] font-bold"
          style={{
            background: isCompleted ? '#2D6A4F' : isActive ? 'var(--accent)' : 'var(--surface3)',
            color: isCompleted || isActive ? '#fff' : 'var(--text-dim)',
            border: !isCompleted && !isActive ? '1px solid var(--border)' : 'none',
          }}
        >
          {isCompleted ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          ) : (
            index + 1
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p
            className="text-[13px] font-semibold truncate"
            style={{ color: isActive ? 'var(--text)' : 'var(--text-dim)' }}
          >
            {step.title}
          </p>
        </div>
      </div>
    </button>
  );
}

export default function PaperDetail() {
  const { slug } = useParams();
  const paper = useMemo(() => papers.find(p => p.slug === slug), [slug]);
  const [activeStep, setActiveStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState(new Set());
  const [showSolution, setShowSolution] = useState(false);
  const [showHints, setShowHints] = useState(false);
  const [showTest, setShowTest] = useState(false);

  if (!paper) return <Navigate to="/code" replace />;

  const step = paper.implementation_steps[activeStep];
  const diffStyle = DIFFICULTY_STYLES[paper.difficulty] || DIFFICULTY_STYLES.beginner;
  const catColor = CATEGORY_COLORS[paper.category] || '#6B6460';

  const handleMarkComplete = () => {
    setCompletedSteps(prev => {
      const next = new Set(prev);
      if (next.has(activeStep)) {
        next.delete(activeStep);
      } else {
        next.add(activeStep);
      }
      return next;
    });
  };

  const handleNext = () => {
    if (activeStep < paper.implementation_steps.length - 1) {
      setActiveStep(activeStep + 1);
      setShowSolution(false);
      setShowHints(false);
      setShowTest(false);
    }
  };

  const handlePrev = () => {
    if (activeStep > 0) {
      setActiveStep(activeStep - 1);
      setShowSolution(false);
      setShowHints(false);
      setShowTest(false);
    }
  };

  const progress = Math.round((completedSteps.size / paper.implementation_steps.length) * 100);

  return (
    <div className="min-h-screen">
      {/* Navbar */}
      <nav className="navbar">
        <Link to="/" className="navbar-brand">Mirage</Link>
        <span className="navbar-sep">/</span>
        <Link to="/code" className="navbar-breadcrumb">Code</Link>
        <span className="navbar-sep">/</span>
        <span className="navbar-breadcrumb" style={{ color: 'var(--text)' }}>
          {paper.title.length > 40 ? paper.title.slice(0, 40) + '…' : paper.title}
        </span>
        <div className="ml-auto">
          <UserMenu />
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 sm:px-8 py-8">
        {/* Paper header */}
        <div className="mb-8 pb-8" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span
              className="text-[11px] font-bold uppercase tracking-[0.08em] px-2.5 py-1 rounded-md"
              style={{ color: catColor, background: `${catColor}12`, border: `1px solid ${catColor}25` }}
            >
              {paper.category}
            </span>
            <span
              className="text-[10px] font-bold uppercase tracking-[0.08em] px-2.5 py-1 rounded-full"
              style={{ color: diffStyle.color, background: diffStyle.bg, border: `1px solid ${diffStyle.border}` }}
            >
              {paper.difficulty}
            </span>
            <span className="text-[12px]" style={{ color: 'var(--text-dim)' }}>
              {paper.authors.join(', ')} · {paper.year}
            </span>
          </div>
          <h1
            className="mb-3"
            style={{
              fontSize: 'clamp(1.5rem, 4vw, 2.5rem)',
              fontWeight: 800,
              color: 'var(--text)',
              letterSpacing: '-0.03em',
              lineHeight: 1.1,
            }}
          >
            {paper.title}
          </h1>
          <p className="text-[15px] leading-relaxed max-w-2xl" style={{ color: 'var(--text-dim)' }}>
            {paper.description}
          </p>

          <div className="flex items-center gap-4 mt-5">
            <a
              href={paper.arxiv_url}
              target="_blank"
              rel="noreferrer"
              className="btn btn-ghost"
              style={{ height: 34, fontSize: 12 }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
              Read Paper
            </a>
            {/* Progress bar */}
            <div className="flex items-center gap-3 ml-auto">
              <span className="text-[12px] font-semibold" style={{ color: 'var(--text-dim)' }}>
                {completedSteps.size}/{paper.implementation_steps.length} completed
              </span>
              <div className="w-32 h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface3)' }}>
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${progress}%`, background: progress === 100 ? '#2D6A4F' : 'var(--accent)' }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Sidebar: step list */}
          <div className="lg:w-72 shrink-0">
            <div className="sticky top-[84px]">
              <h3
                className="text-[11px] font-bold uppercase tracking-[0.14em] mb-4"
                style={{ color: 'var(--text-dim)' }}
              >
                Implementation Steps
              </h3>
              <div className="flex flex-col gap-2">
                {paper.implementation_steps.map((s, i) => (
                  <StepCard
                    key={s.step_id}
                    step={s}
                    index={i}
                    isActive={i === activeStep}
                    isCompleted={completedSteps.has(i)}
                    onClick={() => {
                      setActiveStep(i);
                      setShowSolution(false);
                      setShowHints(false);
                      setShowTest(false);
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Main step content */}
          <div className="flex-1 min-w-0">
            {/* Step header */}
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="text-[11px] font-bold px-2 py-0.5 rounded-md"
                  style={{ background: 'var(--surface3)', color: 'var(--text-dim)', border: '1px solid var(--border)' }}
                >
                  Step {activeStep + 1} of {paper.implementation_steps.length}
                </span>
              </div>
              <h2
                className="mb-2"
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color: 'var(--text)',
                  letterSpacing: '-0.02em',
                }}
              >
                {step.title}
              </h2>
              <p className="text-[14px] leading-relaxed mb-3" style={{ color: 'var(--text-dim)' }}>
                {step.description}
              </p>
              <div
                className="card px-4 py-3"
                style={{ borderRadius: 10, background: 'var(--surface2)', borderColor: 'var(--border)' }}
              >
                <p className="text-[13px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>Objective: </span>
                  {step.objective}
                </p>
              </div>
            </div>

            {/* Starter Code */}
            <div className="mb-6">
              <CodeBlock code={step.code_snippet.starter_code} label={`Starter Code · ${step.code_snippet.language}`} />
            </div>

            {/* Action buttons row */}
            <div className="flex flex-wrap gap-2 mb-6">
              <button
                onClick={() => setShowHints(!showHints)}
                className="btn btn-ghost"
                style={{ height: 36, fontSize: 13 }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
                </svg>
                {showHints ? 'Hide Hints' : 'Show Hints'}
              </button>
              <button
                onClick={() => setShowSolution(!showSolution)}
                className="btn btn-ghost"
                style={{ height: 36, fontSize: 13 }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {showSolution ? 'Hide Solution' : 'Show Solution'}
              </button>
              <button
                onClick={() => setShowTest(!showTest)}
                className="btn btn-ghost"
                style={{ height: 36, fontSize: 13 }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                </svg>
                {showTest ? 'Hide Test' : 'Unit Test'}
              </button>
              <button
                onClick={handleMarkComplete}
                className="btn ml-auto"
                style={{
                  height: 36,
                  fontSize: 13,
                  background: completedSteps.has(activeStep) ? '#edf8f2' : 'var(--accent)',
                  color: completedSteps.has(activeStep) ? '#2D6A4F' : '#fff',
                  border: `1px solid ${completedSteps.has(activeStep) ? '#9dd4b5' : 'var(--accent)'}`,
                }}
              >
                {completedSteps.has(activeStep) ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    Completed
                  </>
                ) : (
                  'Mark Complete'
                )}
              </button>
            </div>

            {/* Hints section */}
            {showHints && (
              <div className="mb-6 card" style={{ borderRadius: 12, padding: '16px 20px', background: '#fdf6e3', borderColor: '#e9c97a' }}>
                <h4 className="text-[12px] font-bold uppercase tracking-[0.1em] mb-3" style={{ color: '#92600A' }}>
                  Hints
                </h4>
                <ol className="flex flex-col gap-2">
                  {step.hints.map((hint, i) => (
                    <li key={i} className="flex gap-2 text-[13px] leading-relaxed" style={{ color: '#6B5500' }}>
                      <span className="font-bold shrink-0" style={{ color: '#92600A' }}>{i + 1}.</span>
                      {hint}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {/* Solution */}
            {showSolution && (
              <div className="mb-6">
                <CodeBlock code={step.code_snippet.solution_code} label="Solution" />
              </div>
            )}

            {/* Unit Test */}
            {showTest && (
              <div className="mb-6">
                <CodeBlock code={step.unit_test} label="Unit Test" />
              </div>
            )}

            {/* Navigation */}
            <div className="flex items-center justify-between pt-6 mt-2" style={{ borderTop: '1px solid var(--border)' }}>
              <button
                onClick={handlePrev}
                className="btn btn-ghost"
                style={{ height: 38, fontSize: 13 }}
                disabled={activeStep === 0}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
                Previous
              </button>
              <button
                onClick={handleNext}
                className="btn btn-primary"
                style={{ height: 38, fontSize: 13 }}
                disabled={activeStep >= paper.implementation_steps.length - 1}
              >
                Next Step
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
