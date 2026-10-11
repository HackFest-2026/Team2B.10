import React, { useState } from 'react';

export default function InsightSidebar({ insights }) {
  const [expanded, setExpanded] = useState(null);

  if (!insights || insights.length === 0) {
    return (
      <div style={{
        padding: 28,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        color: 'var(--text-dim)',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 30, marginBottom: 10 }}>💡</div>
        <p style={{ fontSize: 15, fontWeight: 600 }}>No insights yet</p>
        <p style={{ fontSize: 12, marginTop: 6 }}>Select text in the PDF to add your own note. Automatic insights are optional and are produced only when the worker runs with GENERATE_INSIGHTS=1.</p>
      </div>
    );
  }

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 16,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '16px 18px',
        background: 'var(--surface2)',
        borderBottom: '1px solid var(--border)',
        fontWeight: 700,
        fontSize: 15,
        color: 'var(--text)',
      }}>
        Insights ({insights.length})
      </div>
      <div style={{ overflowY: 'auto', maxHeight: '70vh' }}>
        {insights.map((insight, i) => (
          <div
            key={i}
            style={{
              borderBottom: i < insights.length - 1 ? '1px solid var(--border)' : 'none',
              cursor: 'pointer',
              background: expanded === i ? 'var(--surface2)' : 'var(--surface)',
            }}
            onClick={() => setExpanded(expanded === i ? null : i)}
          >
            <div style={{
              padding: '13px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span style={{
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--accent-light)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}>
                Page {insight.pageNumber}
              </span>
              <span style={{ color: 'var(--text-dim)', fontSize: 14 }}>
                {expanded === i ? '▲' : '▼'}
              </span>
            </div>
            {expanded === i && (
              <div style={{ padding: '0 16px 14px' }}>
                <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--text)', marginBottom: 12 }}>
                  {insight.insightText}
                </p>
                {insight.highlights && insight.highlights.length > 0 && (
                  <div>
                    <p style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: 'var(--text-dim)',
                      marginBottom: 8,
                      textTransform: 'uppercase',
                    }}>
                      Key Phrases
                    </p>
                    {insight.highlights.map((hl, j) => (
                      <div key={j} style={{
                        background: '#fffbeb',
                        border: '1px solid #fde68a',
                        borderRadius: 8,
                        padding: '7px 10px',
                        marginBottom: 6,
                        fontSize: 12,
                        color: '#b45309',
                        fontStyle: 'italic',
                      }}>
                        "{hl.text}"
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
