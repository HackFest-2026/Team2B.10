"""Shared types and helpers for turning source files into Evidence Units (EUs).

An EU is the smallest citable piece of a source:
    {text, loc, fields, parseStatus, confidence, textSha256}
`loc` is the stable source location (page/bbox for scans; line/ts/eventId for logs;
turn/speaker for chats; section/paragraph for reports). Citations resolve to it.
"""
import hashlib
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


class IngestError(Exception):
    """The source cannot be ingested; the message is shown to the user."""


@dataclass
class ParseResult:
    units: List[Dict[str, Any]] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    ocr_confidence: Optional[float] = None
    page_count: Optional[int] = None


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def make_unit(text: str, loc: Dict[str, Any], fields: Optional[Dict[str, Any]] = None,
              parse_status: str = "ok", confidence: Optional[float] = None) -> Dict[str, Any]:
    text = normalize_text(text)
    return {
        "text": text,
        "textSha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        "loc": {k: v for k, v in loc.items() if v is not None},
        "fields": fields or {},
        "parseStatus": parse_status,  # 'ok' | 'raw' (line kept verbatim but not understood)
        "confidence": confidence,
    }


def decode_text(raw: bytes) -> str:
    if b"\x00" in raw[:8192]:
        raise IngestError("File looks binary, expected a text file")
    for enc in ("utf-8-sig", "utf-16") if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else ("utf-8-sig",):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            pass
    return raw.decode("latin-1")


def to_iso(value: Any) -> Optional[str]:
    """Best-effort timestamp -> ISO-8601 UTC. Returns None when it cannot be understood."""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        seconds = value / 1000 if value > 1e11 else value
        try:
            return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat()
        except (OverflowError, OSError, ValueError):
            return None
    text = str(value).strip().replace(",", ".")
    candidates = [text.replace("Z", "+00:00")]
    if " " in text and "T" not in text:
        candidates.append(text.replace(" ", "T", 1).replace("Z", "+00:00"))
    for cand in candidates:
        try:
            dt = datetime.fromisoformat(cand)
            return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).astimezone(timezone.utc).isoformat()
        except ValueError:
            pass
    for fmt in ("%d/%b/%Y:%H:%M:%S %z", "%m/%d/%y, %I:%M %p", "%m/%d/%Y, %I:%M %p", "%d/%m/%Y %H:%M:%S"):
        try:
            dt = datetime.strptime(text, fmt)
            return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).astimezone(timezone.utc).isoformat()
        except ValueError:
            pass
    return None


def pick(record: Dict[str, Any], aliases: List[str]) -> Any:
    lowered = {str(k).lower(): v for k, v in record.items()}
    for name in aliases:
        if name in lowered and lowered[name] not in (None, ""):
            return lowered[name]
    return None
