// Facts derived from system logs. The model only decides which milestone (e.g. "outage start time") a log
// event marks (worker /label-events); the value is the event's own timestamp, taken from the log, and the
// aggregate is deterministic: the earliest matching event for start-type milestones, the latest for end-type.
const { isEndField } = require('./facts');

const NOTABLE_LEVELS = new Set(['WARN', 'ERROR', 'CRIT', 'ALERT', 'EMERG', 'FATAL']);
const NOTABLE_WORDS = /\b(start(?:ed|ing)?|stop(?:ped)?|restor\w*|recover\w*|fail\w*|complet\w*|ready|promot\w*|resum\w*|shut\s?down|boot\w*|time(?:d)?\s?out|exit\w*|crash\w*|unavailable|down|up)\b/i;

const isNotable = (unit) => NOTABLE_LEVELS.has(unit.fields?.level) || NOTABLE_WORDS.test(unit.text);
const formatTimestamp = (iso) => `${new Date(iso).toISOString().slice(0, 19).replace('T', ' ')} UTC`;

/** units: log units carrying `eventField`, `fields.host` and `loc.ts` -> entries for buildConflicts/compareText */
function deriveLogFacts(units) {
  const chosen = new Map();
  for (const u of units) {
    if (!u.eventField || !u.loc?.ts || Number.isNaN(Date.parse(u.loc.ts))) continue;
    const key = `${u.documentId}|${u.fields?.host || ''}|${u.eventField}`;
    const best = chosen.get(key);
    const at = Date.parse(u.loc.ts);
    const wins = !best || (isEndField(u.eventField) ? at > Date.parse(best.loc.ts) : at < Date.parse(best.loc.ts));
    if (wins) chosen.set(key, u);
  }
  return [...chosen.values()].flatMap((u) => {
    // Full ISO timestamps keep their date; legacy syslog stamps ("Mar 14 02:49:44") have no year, so only the clock time is trusted.
    const iso = /^\d{4}-\d{2}-\d{2}T/.test(u.loc.ts);
    const clock = /(\d{1,2}:\d{2}:\d{2})/.exec(u.loc.ts);
    if (!iso && !clock) return [];
    const fact = { subject: String(u.fields?.host || ''), field: u.eventField, quote: u.text, source: 'log' };
    return [{ unit: u, fact: iso ? { ...fact, value: formatTimestamp(u.loc.ts), type: 'datetime' } : { ...fact, value: clock[1], type: 'time' } }];
  });
}

module.exports = { deriveLogFacts, isNotable, formatTimestamp };
