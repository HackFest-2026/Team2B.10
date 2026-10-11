import React from 'react';
import ReactDOM from 'react-dom';

/**
 * SelectionToolbar — floating pill toolbar that appears above selected text.
 *
 * Props:
 *   text        – the selected string
 *   rect        – DOMRect from range.getBoundingClientRect()
 *   onHighlight – () => void  (Add Insight clicked)
 *   onAsk       – () => void  (Ask AI clicked)
 *   onDismiss   – () => void  (click-outside handler, optional)
 */
export default function SelectionToolbar({ text, rect, onHighlight, onAsk }) {
  if (!rect) return null;

  const left = rect.left + rect.width  / 2;
  const top  = rect.top  - 48 + window.scrollY;

  const style = {
    position:     'absolute',
    left,
    top,
    transform:    'translateX(-50%)',
    zIndex:       10000,
    display:      'flex',
    alignItems:   'center',
    gap:          4,
    background:   'var(--surface, #1e2030)',
    border:       '1px solid var(--border, #E2DBD5)',
    borderRadius: 999,
    boxShadow:    '0 4px 6px rgba(0,0,0,0.15), 0 8px 24px rgba(0,0,0,0.4)',
    padding:      '4px 6px',
    whiteSpace:   'nowrap',
    animation:    'selToolbarIn 0.15s cubic-bezier(0.16,1,0.3,1) forwards',
  };

  const btnStyle = (accent) => ({
    display:      'flex',
    alignItems:   'center',
    gap:          5,
    background:   'transparent',
    border:       'none',
    borderRadius: 999,
    padding:      '6px 14px',
    cursor:       'pointer',
    fontSize:     14,
    fontWeight:   600,
    color:        accent || 'var(--text, #2A2520)',
    transition:   'background 0.12s',
  });

  return ReactDOM.createPortal(
    <>
      {/* Inject animation once */}
      {!document.getElementById('sel-toolbar-styles') && (() => {
        const s = document.createElement('style');
        s.id = 'sel-toolbar-styles';
        s.textContent = `
          @keyframes selToolbarIn {
            from { opacity: 0; transform: translateX(-50%) translateY(4px) scale(0.95); }
            to   { opacity: 1; transform: translateX(-50%) translateY(0)    scale(1);    }
          }
          .selToolbarBtn:hover { background: rgba(255,255,255,0.07) !important; }
        `;
        document.head.appendChild(s);
        return null;
      })()}

      <div style={style}>
        {/* Divider between buttons */}
        <button
          className="selToolbarBtn"
          style={btnStyle('rgba(255,215,0,0.85)')}
          onMouseDown={(e) => { e.preventDefault(); onHighlight && onHighlight(text); }}
        >
          ✦ Add Insight
        </button>
        <div style={{ width: 1, height: 16, background: 'var(--border, #E2DBD5)' }} />
        <button
          className="selToolbarBtn"
          style={btnStyle('var(--accent)')}
          onMouseDown={(e) => { e.preventDefault(); onAsk && onAsk(text); }}
        >
          💬 Ask AI
        </button>
      </div>
    </>,
    document.body,
  );
}
