import React, { useLayoutEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';

// Inject keyframe animation once
if (!document.getElementById('insight-tooltip-styles')) {
  const s = document.createElement('style');
  s.id = 'insight-tooltip-styles';
  s.textContent = `
    @keyframes insightTooltipIn {
      from { opacity: 0; transform: scale(0.94) translateY(6px); }
      to   { opacity: 1; transform: scale(1)    translateY(0px); }
    }
    @keyframes insightTooltipInBelow {
      from { opacity: 0; transform: scale(0.94) translateY(-6px); }
      to   { opacity: 1; transform: scale(1)    translateY(0px); }
    }
  `;
  document.head.appendChild(s);
}

/**
 * InsightTooltip — Aceternity-style rich card tooltip.
 *
 * Props:
 *   insight    – { pageNumber, insightText, highlights: [{ text }] }
 *   anchorRect – { centerX, topY, bottomY }  (hotspot element's bounding info)
 */
export default function InsightTooltip({ insight, anchorRect }) {
  const tooltipRef = useRef(null);
  // Start invisible; useLayoutEffect positions & reveals after measurement
  const [style, setStyle] = useState({ opacity: 0, left: 0, top: 0 });
  const [above, setAbove]  = useState(true);

  useLayoutEffect(() => {
    const el = tooltipRef.current;
    if (!el) return;
    const GAP = 12;
    const w   = el.offsetWidth;
    const h   = el.offsetHeight;
    const vw  = window.innerWidth;

    let left = anchorRect.centerX - w / 2;
    let top  = anchorRect.topY - h - GAP;
    let isAbove = true;

    // Flip below the highlight if not enough headroom
    if (top < 8) {
      top     = anchorRect.bottomY + GAP;
      isAbove = false;
    }

    // Clamp to viewport horizontally
    left = Math.max(8, Math.min(left, vw - w - 8));

    setAbove(isAbove);
    setStyle({
      opacity:   1,
      left,
      top,
      animation: isAbove
        ? 'insightTooltipIn 0.18s cubic-bezier(0.16,1,0.3,1) forwards'
        : 'insightTooltipInBelow 0.18s cubic-bezier(0.16,1,0.3,1) forwards',
    });
  }, [anchorRect]);

  if (!insight) return null;

  // How far from the tooltip's left edge the caret should sit
  const caretLeft = Math.max(
    12,
    Math.min((anchorRect.centerX - (style.left || 0)) - 6, 260),
  );

  return ReactDOM.createPortal(
    <div
      ref={tooltipRef}
      style={{
        position:     'fixed',
        left:         style.left,
        top:          style.top,
        zIndex:       9999,
        maxWidth:     320,
        width:        'max-content',
        background:   'var(--surface)',
        border:       '1px solid var(--border)',
        borderRadius: 'var(--radius, 10px)',
        boxShadow:    '0 4px 6px rgba(0,0,0,0.10), 0 16px 40px rgba(0,0,0,0.35)',
        padding:      '16px 20px',
        pointerEvents:'none',
        opacity:      style.opacity,
        animation:    style.animation,
        fontSize:     15,
        color:        'var(--text)',
        lineHeight:   1.6,
      }}
    >
      {/* ── Caret ── */}
      {above ? (
        // Caret on the bottom edge, pointing down toward the highlight
        <>
          <div style={{
            position:   'absolute',
            bottom:     -8,
            left:       caretLeft,
            width:      0,
            height:     0,
            borderLeft: '7px solid transparent',
            borderRight:'7px solid transparent',
            borderTop:  '8px solid var(--border)',
          }} />
          <div style={{
            position:   'absolute',
            bottom:     -6,
            left:       caretLeft + 1,
            width:      0,
            height:     0,
            borderLeft: '6px solid transparent',
            borderRight:'6px solid transparent',
            borderTop:  '7px solid var(--surface)',
          }} />
        </>
      ) : (
        // Caret on the top edge, pointing up toward the highlight
        <>
          <div style={{
            position:    'absolute',
            top:         -8,
            left:        caretLeft,
            width:       0,
            height:      0,
            borderLeft:  '7px solid transparent',
            borderRight: '7px solid transparent',
            borderBottom:'8px solid var(--border)',
          }} />
          <div style={{
            position:    'absolute',
            top:         -6,
            left:        caretLeft + 1,
            width:       0,
            height:      0,
            borderLeft:  '6px solid transparent',
            borderRight: '6px solid transparent',
            borderBottom:'7px solid var(--surface)',
          }} />
        </>
      )}

      {/* ── Header ── */}
      <div style={{
        display:       'flex',
        alignItems:    'center',
        gap:           8,
        marginBottom:  10,
      }}>
        <span style={{
          display:         'inline-flex',
          alignItems:      'center',
          justifyContent:  'center',
          width:           26,
          height:          26,
          borderRadius:    '50%',
          background:      'rgba(245,158,11,0.15)',
          fontSize:        14,
          flexShrink:      0,
        }}>💡</span>
        <span style={{
          fontSize:      13,
          fontWeight:    700,
          color:         'var(--accent-light)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}>
          Page {insight.pageNumber} · Insight
        </span>
      </div>

      {/* ── Divider ── */}
      <div style={{
        height:     1,
        background: 'var(--border)',
        margin:     '0 0 10px',
        opacity:    0.6,
      }} />

      {/* ── Description ── */}
      <p style={{
        margin:      0,
        marginBottom: insight.highlights && insight.highlights.length ? 14 : 0,
        fontSize:    15,
        lineHeight:  1.7,
        color:       'var(--text)',
      }}>
        {insight.insightText}
      </p>

      {/* ── Key phrase chips ── */}
      {insight.highlights && insight.highlights.length > 0 && (
        <div>
          <p style={{
            fontSize:      12,
            fontWeight:    700,
            color:         'var(--text-dim)',
            marginBottom:  7,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}>
            Key Phrases
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {insight.highlights.map((hl, j) => (
              <span key={j} style={{
                background:   'rgba(245,158,11,0.1)',
                border:       '1px solid rgba(245,158,11,0.3)',
                borderRadius: 20,
                padding:      '4px 12px',
                fontSize:     13,
                color:        'var(--warning)',
                fontStyle:    'italic',
                whiteSpace:   'wrap',
              }}>
                &ldquo;{hl.text}&rdquo;
              </span>
            ))}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
