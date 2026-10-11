import { authHeaders } from '../api';
import React, { useState } from 'react';
import ReactDOM from 'react-dom';

export default function AddInsightModal({
  selectedText,
  pageNumber,
  boundingRect,
  projectId,
  documentId,
  onSave,
  onClose,
}) {
  const [note, setNote] = useState('');
  const [tagStr, setTagStr] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSave = async () => {
    if (!note.trim()) {
      setError('Please add an annotation note.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const tags = tagStr.split(',').map((t) => t.trim()).filter(Boolean);
      const res = await fetch(
        `/api/projects/${projectId}/documents/${documentId}/insights`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({
            text: selectedText,
            note: note.trim(),
            tags,
            pageNumber,
            boundingRect,
            type: 'user-created',
          }),
        },
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      const saved = await res.json();
      onSave(saved);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  const overlay = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(42,37,32,0.30)',
    backdropFilter: 'blur(5px)',
    zIndex: 20000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  const card = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 18,
    padding: '32px',
    width: 560,
    maxWidth: '92vw',
    boxShadow: '0 24px 52px rgba(55,50,47,0.12)',
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
  };

  return ReactDOM.createPortal(
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 800, fontSize: 22, color: 'var(--text)', letterSpacing: '-0.03em' }}>
            Add Insight
          </span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 24, lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <div style={{
          background: '#fffbeb',
          border: '1px solid #fde68a',
          borderLeft: '4px solid #f59e0b',
          borderRadius: 10,
          padding: '16px 20px',
          fontSize: 16,
          color: 'var(--text)',
          lineHeight: 1.7,
          maxHeight: 140,
          overflowY: 'auto',
        }}>
          <span style={{ color: '#b45309', fontSize: 13, fontWeight: 700, display: 'block', marginBottom: 8 }}>
            PAGE {pageNumber} · SELECTED TEXT
          </span>
          {selectedText}
        </div>

        <div>
          <label style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-dim)', display: 'block', marginBottom: 10 }}>
            Insight / Annotation *
          </label>
          <textarea
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add your annotation or insight about this passage..."
            rows={4}
            className="input"
            style={{ minHeight: 140, fontSize: 16 }}
          />
        </div>

        <div>
          <label style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-dim)', display: 'block', marginBottom: 10 }}>
            Tags <span style={{ fontWeight: 500 }}>(comma-separated, optional)</span>
          </label>
          <input
            value={tagStr}
            onChange={(e) => setTagStr(e.target.value)}
            placeholder="e.g. important, methodology, results"
            className="input"
            style={{ fontSize: 16 }}
          />
        </div>

        {error && (
          <p style={{ fontSize: 15, color: 'var(--error)', margin: 0 }}>{error}</p>
        )}

        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="btn btn-ghost" style={{ fontSize: 16 }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn btn-primary" style={{ fontSize: 16 }}>
            {saving ? 'Saving...' : 'Save Insight'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
