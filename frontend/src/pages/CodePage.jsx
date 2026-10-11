import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import papers from '../data/papers';
import UserMenu from '../components/UserMenu';

const categories = ['All', ...Array.from(new Set(papers.map(p => p.category)))];
const difficulties = ['All', 'beginner', 'intermediate', 'advanced'];

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

function PaperCard({ paper, onClick }) {
  const diffStyle = DIFFICULTY_STYLES[paper.difficulty] || DIFFICULTY_STYLES.beginner;
  const catColor = CATEGORY_COLORS[paper.category] || '#6B6460';

  return (
    <div
      className="group card cursor-pointer flex flex-col"
      style={{ padding: '0', borderRadius: 16, overflow: 'hidden' }}
      onClick={onClick}
    >
      {/* Color accent bar */}
      <div style={{ height: 3, background: catColor }} />

      <div className="flex flex-col flex-1 p-5 gap-4">
        {/* Top row: category + difficulty */}
        <div className="flex items-center justify-between gap-2">
          <span
            className="text-[11px] font-bold uppercase tracking-[0.08em] px-2 py-[3px] rounded-md"
            style={{ color: catColor, background: `${catColor}12`, border: `1px solid ${catColor}25` }}
          >
            {paper.category}
          </span>
          <span
            className="text-[10px] font-bold uppercase tracking-[0.08em] px-2 py-[3px] rounded-full"
            style={{ color: diffStyle.color, background: diffStyle.bg, border: `1px solid ${diffStyle.border}` }}
          >
            {paper.difficulty}
          </span>
        </div>

        {/* Title */}
        <div>
          <h3
            className="leading-snug"
            style={{
              fontWeight: 700,
              fontSize: 16,
              letterSpacing: '-0.02em',
              color: 'var(--text)',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {paper.title}
          </h3>
          <p className="text-[12px] mt-1.5" style={{ color: 'var(--text-dim)' }}>
            {paper.authors.join(', ')} · {paper.year}
          </p>
        </div>

        {/* Description */}
        <p
          className="text-[13px] leading-relaxed flex-1"
          style={{
            color: 'var(--text-dim)',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {paper.description}
        </p>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="flex items-center gap-1.5">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ color: 'var(--text-dim)' }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
            </svg>
            <span className="text-[12px] font-semibold" style={{ color: 'var(--text-dim)' }}>
              {paper.implementation_steps.length} step{paper.implementation_steps.length !== 1 ? 's' : ''}
            </span>
          </div>

          {paper.is_premium && (
            <span
              className="text-[10px] font-bold uppercase tracking-wider px-2 py-[2px] rounded-full flex items-center gap-1"
              style={{
                background: 'linear-gradient(135deg, #fdf6e3, #fef3c7)',
                color: '#92600A',
                border: '1px solid #e9c97a',
              }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
              Premium
            </span>
          )}

          <svg className="w-4 h-4 opacity-30 group-hover:opacity-60 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </div>
      </div>
    </div>
  );
}

export default function CodePage() {
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedDifficulty, setSelectedDifficulty] = useState('All');
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  const filtered = papers.filter(p => {
    if (selectedCategory !== 'All' && p.category !== selectedCategory) return false;
    if (selectedDifficulty !== 'All' && p.difficulty !== selectedDifficulty) return false;
    if (search && !p.title.toLowerCase().includes(search.toLowerCase()) && !p.description.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="min-h-screen">
      {/* Navbar */}
      <nav className="navbar">
        <Link to="/" className="navbar-brand">Mirage</Link>
        <span className="navbar-sep">/</span>
        <span className="navbar-breadcrumb">Code</span>
        <div className="ml-auto flex items-center gap-3">
          <Link to="/app" className="btn btn-ghost" style={{ height: 34, fontSize: 13 }}>
            Open App
          </Link>
          <UserMenu />
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-8 py-12">
        {/* Header */}
        <div className="mb-12 pb-12" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-6">
            <span className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: 'var(--text-dim)' }}>
              Learn by Building
            </span>
          </div>
          <h1
            className="leading-[1.0] mb-4"
            style={{
              fontSize: 'clamp(2.5rem, 6vw, 4.5rem)',
              fontWeight: 800,
              color: 'var(--text)',
              letterSpacing: '-0.04em',
            }}
          >
            Code the<br />
            <span style={{ color: 'var(--text-dim)', fontWeight: 300 }}>classics.</span>
          </h1>
          <p className="max-w-lg text-[15px] leading-relaxed" style={{ color: 'var(--text-dim)', fontWeight: 400 }}>
            Implement landmark deep learning papers step-by-step. Each paper breaks down into focused coding exercises with hints, starter code, and unit tests.
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-8">
          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <input
              className="input pl-10"
              placeholder="Search papers..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ height: 38, fontSize: 13 }}
            />
          </div>

          {/* Category chips */}
          <div className="flex flex-wrap gap-2">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className="px-3 py-1.5 rounded-full text-[12px] font-semibold transition-all"
                style={{
                  background: selectedCategory === cat ? 'var(--accent)' : 'var(--surface)',
                  color: selectedCategory === cat ? '#fff' : 'var(--text-dim)',
                  border: `1px solid ${selectedCategory === cat ? 'var(--accent)' : 'var(--border)'}`,
                }}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Difficulty chips */}
          <div className="flex flex-wrap gap-2">
            {difficulties.map(d => {
              const style = d === 'All' ? null : DIFFICULTY_STYLES[d];
              return (
                <button
                  key={d}
                  onClick={() => setSelectedDifficulty(d)}
                  className="px-3 py-1.5 rounded-full text-[12px] font-semibold capitalize transition-all"
                  style={{
                    background: selectedDifficulty === d
                      ? (style ? style.bg : 'var(--accent)')
                      : 'var(--surface)',
                    color: selectedDifficulty === d
                      ? (style ? style.color : '#fff')
                      : 'var(--text-dim)',
                    border: `1px solid ${selectedDifficulty === d
                      ? (style ? style.border : 'var(--accent)')
                      : 'var(--border)'}`,
                  }}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>

        {/* Results count */}
        <div className="flex items-center gap-2 mb-6">
          <span className="text-[12px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--text-dim)' }}>
            Papers
          </span>
          <span
            className="text-[12px] font-bold px-2.5 py-0.5 rounded-full"
            style={{ color: 'var(--text-dim)', background: 'var(--surface2)', border: '1px solid var(--border)' }}
          >
            {filtered.length}
          </span>
        </div>

        {/* Paper Grid */}
        {filtered.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-24 rounded-2xl"
            style={{ border: '1.5px dashed var(--border)', background: 'var(--surface2)' }}
          >
            <div
              className="w-14 h-14 rounded-2xl mb-5 flex items-center justify-center"
              style={{ background: 'var(--surface3)', border: '1px solid var(--border)' }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--text-dim)' }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
              </svg>
            </div>
            <h3
              className="text-[17px] mb-2"
              style={{
                color: 'var(--text)',
                fontWeight: 700,
                letterSpacing: '-0.03em',
              }}
            >No papers match</h3>
            <p className="text-[14px]" style={{ color: 'var(--text-dim)' }}>Try adjusting your filters or search</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map(paper => (
              <PaperCard
                key={paper.id}
                paper={paper}
                onClick={() => navigate(`/code/${paper.slug}`)}
              />
            ))}
          </div>
        )}
      </div>

      <footer className="py-8 text-center" style={{ borderTop: '1px solid var(--border)' }}>
        <span className="text-[13px] font-semibold" style={{ color: 'var(--text-dim)' }}>
          {papers.length} papers · {papers.reduce((a, p) => a + p.implementation_steps.length, 0)} coding steps
        </span>
      </footer>
    </div>
  );
}
