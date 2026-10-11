import React from 'react';
import { CLASSIFICATIONS, CLASSIFICATION_HELP } from '../classification';
import ClassificationBadge from './ClassificationBadge';

// Plain-language explanation of classification levels, shown next to the upload controls.
export default function ClassificationHelp({ clearance = 0 }) {
  return (
    <details style={{ marginTop: 8, fontSize: 12.5, color: 'var(--text-dim)' }} data-testid="classification-help">
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>What does "{CLASSIFICATIONS[0]}" mean? What are classification levels?</summary>
      <div style={{ marginTop: 8, lineHeight: 1.6 }}>
        <p>
          Every source you upload gets a <b>classification level</b>, and every user has a <b>clearance</b>. You can only
          see, search, chat with, analyse and cite sources at or below your own clearance (yours is <b>{CLASSIFICATIONS[clearance]}</b>).
          Chat answers, summaries, reports and exports never include anything above the reader's level, and a report is
          marked with the highest level of the sources it used.
        </p>
        <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none' }}>
          {CLASSIFICATIONS.map((name, level) => (
            <li key={name} style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginTop: 4 }}>
              <span style={{ width: 96, flexShrink: 0 }}><ClassificationBadge level={level} /></span>
              <span>{CLASSIFICATION_HELP[level]}</span>
            </li>
          ))}
        </ul>
        <p style={{ marginTop: 8 }}><b>Unclassified</b> is the default and the lowest level: the file is open to every user, so nothing is hidden from anyone. Pick a higher level for material that only some people should see.</p>
      </div>
    </details>
  );
}
