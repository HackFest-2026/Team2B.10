"""System-log parser: text (syslog/ISO/key=value/access logs), JSON, JSON-lines and CSV."""
import csv
import io
import json
import re
from typing import Any, Dict, List, Optional

from .common import IngestError, ParseResult, make_unit, pick, to_iso

TS_KEYS = ["timestamp", "ts", "time", "@timestamp", "datetime", "date", "eventtime", "created_at", "createdat", "published", "occurred_at"]
LEVEL_KEYS = ["level", "severity", "lvl", "loglevel"]
HOST_KEYS = ["host", "hostname", "node", "source"]
SERVICE_KEYS = ["service", "app", "application", "process", "program", "logger", "component"]
MESSAGE_KEYS = ["message", "msg", "event", "log", "description", "text", "title", "summary", "place", "body", "name"]
ID_KEYS = ["event_id", "eventid", "id", "uuid", "trace_id"]
KNOWN = set(TS_KEYS + LEVEL_KEYS + HOST_KEYS + SERVICE_KEYS + MESSAGE_KEYS + ID_KEYS)

ISO_TS = r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?"
LEVELS = r"TRACE|DEBUG|INFO|NOTICE|WARN(?:ING)?|ERROR|ERR|CRIT(?:ICAL)?|ALERT|EMERG|FATAL|SEVERE"

RE_5424 = re.compile(r"^<(\d{1,3})>1 (\S+) (\S+) (\S+) (\S+) (\S+) (?:-|\[.*?\]) ?(.*)$")
RE_3164 = re.compile(r"^(?:<\d{1,3}>)?([A-Z][a-z]{2}\s+\d{1,2} \d{2}:\d{2}:\d{2}) (\S+) ([^\s:\[]+)(?:\[(\d+)\])?: ?(.*)$")
RE_KV_LINE = re.compile(rf"^({ISO_TS})\s+((?:[\w.@-]+=(?:\"[^\"]*\"|\S+)\s*)+)$")
RE_ISO_LEVEL = re.compile(rf"^({ISO_TS})\s+\[?({LEVELS})\]?\s+(?:\[([^\]]+)\]\s*)?(.*)$", re.I)
# Hadoop/HDFS: "081109 203615 148 INFO dfs.DataNode$PacketResponder: message" (yyMMdd HHmmss pid LEVEL component)
RE_HADOOP = re.compile(rf"^(\d{{6}}) (\d{{6}}) (\d+) ({LEVELS}) ([\w.$]+): ?(.*)$")
RE_ACCESS = re.compile(r'^(\S+) \S+ (\S+) \[([^\]]+)\] "([^"]*)" (\d{3}) (\S+)(?: "([^"]*)" "([^"]*)")?')
RE_KV = re.compile(r'([\w.@-]+)=("[^"]*"|\S+)')
RE_CONTINUATION = re.compile(r"^(\s+|Caused by:|\.\.\. \d+ more|Traceback \(most recent|[\w.$]+(?:Exception|Error)\b)")

SYSLOG_SEVERITY = ["EMERG", "ALERT", "CRIT", "ERROR", "WARN", "NOTICE", "INFO", "DEBUG"]


def _norm_level(level: Any) -> Optional[str]:
    if level is None:
        return None
    text = str(level).upper()
    return {"WARNING": "WARN", "ERR": "ERROR", "CRITICAL": "CRIT", "SEVERE": "ERROR"}.get(text, text)


def _render(fields: Dict[str, Any]) -> str:
    """Canonical one-line text for an event; this is what gets embedded and quoted."""
    parts = [fields.get("timestamp"), fields.get("host"), fields.get("service")]
    head = " ".join(str(p) for p in parts if p)
    level = fields.get("level")
    message = fields.get("message") or ""
    extras = " ".join(f"{k}={v}" for k, v in (fields.get("extra") or {}).items())
    body = f"{level}: {message}" if level else message
    return " ".join(x for x in [head, body, extras] if x)


def _from_record(rec: Dict[str, Any]) -> Dict[str, Any]:
    ts_raw = pick(rec, TS_KEYS)
    fields = {
        "timestamp": to_iso(ts_raw) or (str(ts_raw) if ts_raw else None),
        "level": _norm_level(pick(rec, LEVEL_KEYS)),
        "host": pick(rec, HOST_KEYS),
        "service": pick(rec, SERVICE_KEYS),
        "message": str(pick(rec, MESSAGE_KEYS) or ""),
        "eventId": pick(rec, ID_KEYS),
        "extra": {k: v for k, v in rec.items() if str(k).lower() not in KNOWN and v not in (None, "")},
    }
    return fields


def _unit_from_fields(fields: Dict[str, Any], line: int, line_end: int, event_id: Optional[str] = None):
    event_id = fields.get("eventId") or event_id or f"L{line}"
    loc = {"line": line, "lineEnd": line_end if line_end != line else None, "ts": fields.get("timestamp"), "eventId": str(event_id)}
    public = {k: v for k, v in fields.items() if k != "extra" and v is not None}
    if fields.get("extra"):
        public["extra"] = fields["extra"]
    return make_unit(_render(fields), loc, public)


def _parse_text_line(line: str) -> Optional[Dict[str, Any]]:
    m = RE_5424.match(line)
    if m:
        pri = int(m.group(1))
        return {"timestamp": to_iso(m.group(2)) or m.group(2), "host": m.group(3), "service": m.group(4),
                "level": SYSLOG_SEVERITY[pri % 8], "message": m.group(7), "extra": {"pid": m.group(5)} if m.group(5) != "-" else {}}
    m = RE_3164.match(line)
    if m:
        extra = {"pid": m.group(4)} if m.group(4) else {}
        return {"timestamp": m.group(1), "host": m.group(2), "service": m.group(3), "message": m.group(5), "extra": extra}
    m = RE_KV_LINE.match(line)
    if m:
        pairs = {k: v.strip('"') for k, v in RE_KV.findall(m.group(2))}
        rec = _from_record({**pairs, "timestamp": m.group(1)})
        return rec
    m = RE_ISO_LEVEL.match(line)
    if m:
        return {"timestamp": to_iso(m.group(1)) or m.group(1), "level": _norm_level(m.group(2)), "service": m.group(3),
                "message": m.group(4), "extra": {}}
    m = RE_HADOOP.match(line)
    if m:
        d, t = m.group(1), m.group(2)
        iso = to_iso(f"20{d[0:2]}-{d[2:4]}-{d[4:6]}T{t[0:2]}:{t[2:4]}:{t[4:6]}")
        return {"timestamp": iso, "level": _norm_level(m.group(4)), "service": m.group(5), "message": m.group(6), "extra": {"pid": m.group(3)}}
    m = RE_ACCESS.match(line)
    if m:
        extra = {"status": m.group(5), "bytes": m.group(6)}
        if m.group(8):
            extra["agent"] = m.group(8)
        return {"timestamp": to_iso(m.group(3)) or m.group(3), "host": m.group(1), "service": "access",
                "level": "ERROR" if m.group(5).startswith("5") else None,
                "message": m.group(4), "extra": {"user": m.group(2), **extra}}
    return None


def _parse_text(text: str, result: ParseResult) -> None:
    last_fields = None
    last_start = last_end = 0
    raw = parsed = 0

    def flush():
        nonlocal last_fields
        if last_fields is not None:
            result.units.append(_unit_from_fields(last_fields, last_start, last_end))
            last_fields = None

    for number, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        fields = _parse_text_line(line.strip()) if not line[0].isspace() else None
        if fields is not None:
            flush()
            last_fields, last_start, last_end = fields, number, number
            parsed += 1
        elif last_fields is not None and RE_CONTINUATION.match(line):
            # stack-trace / wrapped line: belongs to the previous event
            last_fields["message"] += " " + line.strip()
            last_end = number
        else:
            flush()
            raw += 1
            result.units.append(make_unit(line, {"line": number, "eventId": f"L{number}"}, {}, parse_status="raw"))
    flush()
    if raw:
        total = raw + parsed
        result.warnings.append(f"{raw} of {total} lines did not match a known log format and were kept as raw lines")


MAX_EXTRAS = 12
MAX_EXTRA_CHARS = 120


def _flatten(value: Any, prefix: str = "", out: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Nested JSON -> {"a.b.0.c": scalar}. Lists of scalars become one comma-separated value."""
    out = {} if out is None else out
    if isinstance(value, dict):
        for k, v in value.items():
            _flatten(v, f"{prefix}.{k}" if prefix else str(k), out)
    elif isinstance(value, list):
        if all(not isinstance(v, (dict, list)) for v in value):
            if value:
                out[prefix] = ", ".join(str(v) for v in value)
        else:
            for i, v in enumerate(value):
                _flatten(v, f"{prefix}.{i}", out)
    elif value is not None and value != "":
        out[prefix] = value
    return out


VALUE_LEAVES = ("value", "text", "content", "description", "message")


def _pick_flat(flat: Dict[str, Any], aliases: List[str]) -> Any:
    """First alias that matches a key's last path component; shallower keys win ("cve.id" beats "cve.metrics.x.id").
    Failing that, an alias naming a list or object ("descriptions" for "descriptions.0.value") picks its value-like field."""
    for name in aliases:
        hits = sorted((k for k in flat if k.lower().rsplit(".", 1)[-1] == name), key=lambda k: (k.count("."), k))
        if hits:
            return flat[hits[0]]
    for name in aliases:
        hits = sorted((k for k in flat if any(part in (name, name + "s") for part in k.lower().split(".")[:-1])
                       and k.lower().rsplit(".", 1)[-1] in VALUE_LEAVES), key=lambda k: (k.count("."), k))
        if hits:
            return flat[hits[0]]
    return None


def _from_nested_record(rec: Dict[str, Any]) -> Dict[str, Any]:
    flat = _flatten(rec)
    ts_raw = _pick_flat(flat, TS_KEYS)
    used = {k for k in flat if k.lower().rsplit(".", 1)[-1] in KNOWN or any(p in KNOWN or p.rstrip("s") in KNOWN for p in k.lower().split(".")[:-1])}
    message = _pick_flat(flat, MESSAGE_KEYS)
    if message is None:  # nothing message-like: describe the record by its first few scalar fields
        message = "; ".join(f"{k.rsplit('.', 1)[-1]}={v}" for k, v in list(flat.items())[:6])
    extras = {}
    for k, v in flat.items():
        if k in used or len(extras) >= MAX_EXTRAS:
            continue
        extras[k] = v if not isinstance(v, str) or len(v) <= MAX_EXTRA_CHARS else v[:MAX_EXTRA_CHARS] + "…"
    return {
        "timestamp": to_iso(ts_raw) or (str(ts_raw) if ts_raw else None),
        "level": _norm_level(_pick_flat(flat, LEVEL_KEYS)),
        "host": _pick_flat(flat, HOST_KEYS),
        "service": _pick_flat(flat, SERVICE_KEYS),
        "message": str(message),
        "eventId": _pick_flat(flat, ID_KEYS),
        "extra": extras,
    }


def _unwrap_records(data: Any) -> Optional[List[Any]]:
    """{"vulnerabilities":[...]} / GeoJSON {"features":[...]} -> the record list. None when the object is itself one record."""
    if not isinstance(data, dict):
        return None
    lists = [v for v in data.values() if isinstance(v, list) and v and all(isinstance(x, dict) for x in v)]
    return max(lists, key=len) if lists else None


def _parse_json(text: str, result: ParseResult) -> None:
    stripped = text.lstrip()
    records: List[tuple] = []  # (line, record)
    nested = False
    whole = None
    if stripped.startswith("{"):
        try:
            whole = json.loads(text)  # one object (API response); several lines of objects are JSON-lines instead
        except json.JSONDecodeError:
            whole = None
    unwrapped = _unwrap_records(whole)
    if unwrapped is not None:
        records = [(i + 1, r) for i, r in enumerate(unwrapped)]
        nested = True
    elif isinstance(whole, dict):
        records = [(1, whole)]
        nested = True
    elif stripped.startswith("["):
        try:
            data = json.loads(text)
        except json.JSONDecodeError as e:
            raise IngestError(f"Invalid JSON: {e}")
        records = [(i + 1, r) for i, r in enumerate(data)]  # location = array index (1-based)
    else:
        for number, line in enumerate(text.splitlines(), start=1):
            if not line.strip():
                continue
            try:
                records.append((number, json.loads(line)))
            except json.JSONDecodeError:
                result.units.append(make_unit(line, {"line": number, "eventId": f"L{number}"}, {}, parse_status="raw"))
    bad = 0
    for line, rec in records:
        if not isinstance(rec, dict):
            bad += 1
            result.units.append(make_unit(json.dumps(rec), {"line": line, "eventId": f"L{line}"}, {}, parse_status="raw"))
            continue
        fields = _from_nested_record(rec) if nested or any(isinstance(v, (dict, list)) for v in rec.values()) else _from_record(rec)
        result.units.append(_unit_from_fields(fields, line, line))
    raw = sum(1 for u in result.units if u["parseStatus"] == "raw")
    if raw:
        result.warnings.append(f"{raw} records could not be parsed and were kept as raw lines")


def _parse_csv(text: str, result: ParseResult) -> None:
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise IngestError("CSV has no header row")
    lowered = {f.lower() for f in reader.fieldnames if f}
    if not lowered & set(MESSAGE_KEYS):
        raise IngestError(f"CSV needs a message column (one of: {', '.join(MESSAGE_KEYS)})")
    for rec in reader:
        line = reader.line_num  # physical line where this record ends; header is line 1
        result.units.append(_unit_from_fields(_from_record({k: v for k, v in rec.items() if k}), line, line))


def parse_syslog(text: str, extension: str) -> ParseResult:
    result = ParseResult()
    if extension in ("json", "jsonl", "ndjson"):
        _parse_json(text, result)
    elif extension == "csv":
        _parse_csv(text, result)
    else:
        _parse_text(text, result)
    return result
