"""Conversation-log parser: transcripts, WhatsApp/Slack-style exports, JSON and CSV. One EU per turn."""
import csv
import io
import json
import re
from typing import Any, Dict, List

from .common import IngestError, ParseResult, make_unit, pick, to_iso

SPEAKER_KEYS = ["speaker", "user", "author", "from", "sender", "role", "name", "username"]
TEXT_KEYS = ["text", "message", "content", "body", "msg"]
TS_KEYS = ["timestamp", "ts", "time", "date", "created_at", "datetime"]

TS = r"(?:\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?|\d{1,2}/\d{1,2}/\d{2,4},? \d{1,2}:\d{2}(?::\d{2})?(?: ?[APap][Mm])?|\d{1,2}:\d{2}(?::\d{2})?(?: ?[APap][Mm])?)"
SPEAKER = r"([A-Za-z][\w .'@()-]{0,40}?)"
RE_TURN = re.compile(rf"^(?:\[({TS})\]\s*|({TS})(?:\s+-\s+|\s+))?{SPEAKER}\s*:\s+(.*)$")


def _turn_unit(turn: int, line: int, line_end: int, speaker: str, text: str, ts_raw):
    ts = to_iso(ts_raw) or (str(ts_raw) if ts_raw else None)
    loc = {"turn": turn, "line": line, "lineEnd": line_end if line_end != line else None, "ts": ts, "speaker": speaker}
    return make_unit(f"{speaker}: {text}", loc, {"speaker": speaker, "timestamp": ts, "message": text})


def _parse_text(text: str, result: ParseResult) -> None:
    current = None  # [turn, start, end, speaker, text, ts]
    turn = 0
    unparsed = 0

    def flush():
        nonlocal current
        if current:
            result.units.append(_turn_unit(*current))
            current = None

    for number, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        m = RE_TURN.match(line.strip())
        if m:
            flush()
            turn += 1
            ts = m.group(1) or m.group(2)
            current = [turn, number, number, m.group(3).strip(), m.group(4).strip(), ts]
        elif current:
            current[4] += " " + line.strip()  # wrapped line belongs to the current turn
            current[2] = number
        else:
            unparsed += 1
            result.units.append(make_unit(line, {"line": number}, {}, parse_status="raw"))
    flush()
    if unparsed:
        result.warnings.append(f"{unparsed} lines before the first speaker turn were kept as raw lines")
    if not turn:
        raise IngestError("No 'Speaker: message' turns found in this conversation log")


def _records_to_units(records: List[tuple], result: ParseResult) -> None:
    turn = 0
    for line, rec in records:
        if not isinstance(rec, dict):
            continue
        message = pick(rec, TEXT_KEYS)
        if message is None:
            result.units.append(make_unit(json.dumps(rec), {"line": line}, {}, parse_status="raw"))
            continue
        turn += 1
        speaker = str(pick(rec, SPEAKER_KEYS) or "unknown")
        result.units.append(_turn_unit(turn, line, line, speaker, str(message), pick(rec, TS_KEYS)))
    if not turn:
        raise IngestError("No messages found: expected objects with a text/message field")


def _parse_json(text: str, result: ParseResult) -> None:
    stripped = text.lstrip()
    if stripped.startswith(("[", "{")) and not re.search(r"\}\s*\n\s*\{", stripped):
        try:
            data = json.loads(text)
        except json.JSONDecodeError as e:
            raise IngestError(f"Invalid JSON: {e}")
        if isinstance(data, dict):
            data = next((v for v in data.values() if isinstance(v, list)), None)
            if data is None:
                raise IngestError("JSON object has no message list")
        _records_to_units([(i + 1, r) for i, r in enumerate(data)], result)  # location = array index (1-based)
        return
    records = []
    for number, line in enumerate(text.splitlines(), start=1):
        if line.strip():
            try:
                records.append((number, json.loads(line)))
            except json.JSONDecodeError:
                result.units.append(make_unit(line, {"line": number}, {}, parse_status="raw"))
    _records_to_units(records, result)


def _parse_csv(text: str, result: ParseResult) -> None:
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames or not {f.lower() for f in reader.fieldnames if f} & set(TEXT_KEYS):
        raise IngestError(f"CSV needs a message column (one of: {', '.join(TEXT_KEYS)})")
    _records_to_units([(reader.line_num, {k: v for k, v in rec.items() if k}) for rec in reader], result)


def parse_chatlog(text: str, extension: str) -> ParseResult:
    result = ParseResult()
    if extension in ("json", "jsonl", "ndjson"):
        _parse_json(text, result)
    elif extension == "csv":
        _parse_csv(text, result)
    else:
        _parse_text(text, result)
    return result
