// Single source of truth for what can be ingested. Keep in sync with worker/parsers/__init__.py.
const SOURCE_TYPES = {
  scan: ['pdf', 'png', 'jpg', 'jpeg', 'tif', 'tiff'],
  report: ['pdf', 'docx', 'txt', 'md'],
  chatlog: ['txt', 'log', 'json', 'jsonl', 'csv'],
  syslog: ['txt', 'log', 'json', 'jsonl', 'csv'],
};

const CLASSIFICATIONS = ['Unclassified', 'Restricted', 'Secret', 'Top Secret'];
const MAX_CLASSIFICATION = CLASSIFICATIONS.length - 1;

const MIME = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', tif: 'image/tiff', tiff: 'image/tiff',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', log: 'text/plain; charset=utf-8',
  json: 'application/json', jsonl: 'application/x-ndjson', csv: 'text/csv; charset=utf-8',
};

const ALLOWED_EXTENSIONS = new Set(Object.values(SOURCE_TYPES).flat());
const extensionOf = (name = '') => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');

module.exports = { SOURCE_TYPES, CLASSIFICATIONS, MAX_CLASSIFICATION, MIME, ALLOWED_EXTENSIONS, extensionOf };
