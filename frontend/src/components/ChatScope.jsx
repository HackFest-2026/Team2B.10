import React from 'react';

// Which documents a chat question may use. mode: 'project' | 'document' | 'pick'.
export const defaultScope = (thisDocumentId) => ({ mode: thisDocumentId ? 'document' : 'project', ids: [] });

export function scopeDocumentIds(scope, thisDocumentId) {
  if (scope.mode === 'document' && thisDocumentId) return [thisDocumentId];
  if (scope.mode === 'pick') return scope.ids;
  return [];
}

export function describeScope(scope) {
  if (!scope) return '';
  if (scope.type === 'project') return 'whole project';
  const names = (scope.documents || []).map((d) => d.filename);
  return names.length === 1 ? names[0] : `${names.length} documents`;
}

export default function ChatScope({ documents = [], thisDocumentId, scope, onChange, disabled }) {
  const ready = documents.filter((d) => d.status === 'DONE');
  const set = (mode) => onChange({ mode, ids: mode === 'pick' ? scope.ids : [] });
  const toggle = (id) => onChange({ mode: 'pick', ids: scope.ids.includes(id) ? scope.ids.filter((x) => x !== id) : [...scope.ids, id] });
  const picked = scope.mode === 'pick' ? scope.ids.length : 0;

  const chip = (mode, label, hidden) => hidden ? null : (
    <button
      key={mode}
      type="button"
      disabled={disabled}
      onClick={() => set(mode)}
      aria-pressed={scope.mode === mode}
      style={{
        background: scope.mode === mode ? 'var(--accent)' : 'var(--surface2)',
        color: scope.mode === mode ? '#fff' : 'var(--text-dim)',
        border: '1px solid var(--border)',
        borderRadius: 999,
        padding: '3px 10px',
        fontSize: 11,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {label}
    </button>
  );

  return (
    <div data-testid="chat-scope" style={{ flexShrink: 0, marginBottom: 8 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-dim)' }}>SCOPE</span>
        {chip('project', 'Whole project')}
        {chip('document', 'This document', !thisDocumentId)}
        {chip('pick', picked ? `Pick documents… (${picked})` : 'Pick documents…')}
      </div>
      {scope.mode === 'pick' && (
        <div style={{ marginTop: 6, maxHeight: 120, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 8px', background: 'var(--surface)' }}>
          {ready.length === 0 && <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>No processed documents yet.</div>}
          {ready.map((d) => (
            <label key={d._id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, padding: '2px 0', cursor: 'pointer' }}>
              <input type="checkbox" checked={scope.ids.includes(d._id)} onChange={() => toggle(d._id)} disabled={disabled} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.filename}</span>
            </label>
          ))}
          {scope.ids.length === 0 && ready.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-dim)', paddingTop: 2 }}>Nothing ticked: questions use the whole project.</div>
          )}
        </div>
      )}
    </div>
  );
}
