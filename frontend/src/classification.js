// Must match backend/sourceTypes.js
export const CLASSIFICATIONS = ['Unclassified', 'Restricted', 'Secret', 'Top Secret'];

export const CLASSIFICATION_STYLE = [
  { color: '#2f6b3b', bg: 'rgba(47,107,59,0.10)' },
  { color: '#8a6200', bg: 'rgba(200,150,0,0.14)' },
  { color: '#a8460f', bg: 'rgba(214,98,25,0.14)' },
  { color: '#a3211f', bg: 'rgba(190,40,36,0.14)' },
];

export const SOURCE_TYPES = {
  scan: { label: 'Scanned document', hint: 'PDF or image, read with OCR', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'tif', 'tiff'] },
  report: { label: 'Report / manual', hint: 'PDF, DOCX, TXT, MD', extensions: ['pdf', 'docx', 'txt', 'md'] },
  chatlog: { label: 'Conversation log', hint: 'TXT, JSON, CSV transcripts', extensions: ['txt', 'log', 'json', 'jsonl', 'csv'] },
  syslog: { label: 'System log', hint: 'syslog, app logs, JSON lines, CSV', extensions: ['txt', 'log', 'json', 'jsonl', 'csv'] },
};

export const extensionOf = (name = '') => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');

export const CLASSIFICATION_HELP = [
  'Public material. Anyone with an account can read, search and cite it.',
  'Internal material. Readable only by people cleared for Restricted or higher.',
  'Sensitive material. Readable only by people cleared for Secret or higher.',
  'Most sensitive material. Readable only by people cleared for Top Secret.',
];
