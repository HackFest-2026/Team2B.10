import React from 'react';
import { CLASSIFICATIONS, CLASSIFICATION_STYLE, CLASSIFICATION_HELP } from '../classification';

export default function ClassificationBadge({ level = 0 }) {
  const style = CLASSIFICATION_STYLE[level] || CLASSIFICATION_STYLE[0];
  return (
    <span
      className="text-[10.5px] font-bold uppercase tracking-[0.08em] px-2 py-[3px] rounded-md whitespace-nowrap"
      style={{ color: style.color, background: style.bg }}
      title={`${CLASSIFICATIONS[level] || 'Unknown'}: ${CLASSIFICATION_HELP[level] || ''}`}
    >
      {CLASSIFICATIONS[level] || 'Unknown'}
    </span>
  );
}
