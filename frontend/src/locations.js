// Human-readable source location for an evidence unit, e.g. "page 3 · block 2" or "line 41".
export function describeLocation(loc = {}) {
  const parts = [];
  if (loc.page != null) parts.push(`page ${loc.page}`);
  if (loc.block != null) parts.push(`block ${loc.block}`);
  if (loc.turn != null) parts.push(`turn ${loc.turn}`);
  if (loc.line != null) parts.push(loc.lineEnd ? `lines ${loc.line}–${loc.lineEnd}` : `line ${loc.line}`);
  if (loc.table != null) parts.push(`table ${loc.table} row ${loc.row}`);
  if (loc.paragraph != null && loc.line == null) parts.push(`¶ ${loc.paragraph}`);
  if (loc.section) parts.push(loc.section);
  return parts.join(' · ') || '—';
}
