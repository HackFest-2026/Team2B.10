"""Pure scoring functions for the evaluation. No I/O, no network: everything here is unit-tested."""
import re
from typing import Dict, Iterable, List, Optional, Tuple


# ── text accuracy ───────────────────────────────────────────────────────────

def normalize_text(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


def edit_distance(a: str, b: str) -> int:
    if a == b:
        return 0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def char_accuracy(truth: str, hypothesis: str) -> float:
    """1 - character error rate, on whitespace/case-normalised text, floored at 0."""
    t, h = normalize_text(truth), normalize_text(hypothesis)
    if not t:
        return 1.0 if not h else 0.0
    return max(0.0, 1.0 - edit_distance(t, h) / len(t))


# ── set and pairwise scores ─────────────────────────────────────────────────

def prf(tp: int, fp: int, fn: int) -> Dict[str, float]:
    p = tp / (tp + fp) if tp + fp else 1.0
    r = tp / (tp + fn) if tp + fn else 1.0
    return {"precision": p, "recall": r, "f1": 2 * p * r / (p + r) if p + r else 0.0, "tp": tp, "fp": fp, "fn": fn}


def pairwise_prf(items: List[Tuple[Optional[str], str]]) -> Dict[str, float]:
    """items: (true label or None, predicted cluster). Unlabelled (ambiguous) items are not scored."""
    labelled = [i for i in items if i[0] is not None]
    tp = fp = fn = 0
    for i in range(len(labelled)):
        for j in range(i + 1, len(labelled)):
            same, joined = labelled[i][0] == labelled[j][0], labelled[i][1] == labelled[j][1]
            tp += same and joined
            fp += (not same) and joined
            fn += same and (not joined)
    return prf(tp, fp, fn)


# ── facts ───────────────────────────────────────────────────────────────────

FIELD_CLASSES = [
    ("duration", re.compile(r"duration|lasted|length|elapsed")),
    ("start", re.compile(r"start|began|begin|onset|first|opened")),
    ("end", re.compile(r"\bend|ended|finish|resolved|restor|recover|closed|last")),
    ("sessions", re.compile(r"session")),
    ("severity", re.compile(r"severity|priority")),
    ("person", re.compile(r"responsib|owner|assigned|on-call|lead")),
]


def field_class(name: str) -> Optional[str]:
    n = name.lower()
    for cls, rx in FIELD_CLASSES:
        if rx.search(n):
            return cls
    return None


def norm_clock(value: str) -> Optional[str]:
    m = re.search(r"(\d{1,2}):(\d{2})", value)
    return f"{int(m.group(1)):02d}:{m.group(2)}" if m else None


def norm_number(value: str) -> Optional[str]:
    m = re.search(r"\d[\d,]*(?:\.\d+)?", value)
    return m.group(0).replace(",", "") if m else None


def norm_value(cls: str, value: str) -> Optional[str]:
    if cls in ("start", "end"):
        return norm_clock(value)
    if cls in ("sessions", "duration", "severity"):
        return norm_number(value)
    return value.strip().lower()


def minutes(clock: str) -> int:
    return int(clock[:2]) * 60 + int(clock[3:])


def same_value(cls: str, a: str, b: str) -> bool:
    if cls in ("start", "end") and a and b:
        return abs(minutes(a) - minutes(b)) <= 1
    return a == b


def score_facts(truth: List[Dict], predicted: List[Dict], resolve_person) -> Dict[str, float]:
    """
    truth/predicted: {doc, class, value}. Predicted facts whose field maps to no known class are ignored (they are
    neither right nor wrong); a person value is resolved to an entity id by `resolve_person` before comparing.
    """
    def key(f):
        v = resolve_person(f["value"]) if f["class"] == "person" else f["value"]
        return (f["doc"], f["class"], v)

    def matches(t, p):
        return t["doc"] == p["doc"] and t["class"] == p["class"] and (
            resolve_person(p["value"]) == t["value"] if t["class"] == "person" else same_value(t["class"], t["value"], p["value"]))

    # truth with person values already canonical ids; predicted values normalised by the caller
    tp = sum(1 for t in truth if any(matches(t, p) for p in predicted))
    fn = len(truth) - tp
    fp = sum(1 for p in predicted if not any(matches(t, p) for t in truth))
    return prf(tp, fp, fn)


# ── grounding of statements ─────────────────────────────────────────────────

_DATE = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")
_TIME = re.compile(r"(?<![\w:.-])(\d{1,2}):(\d{2})(?::\d{2})?(?![\w:-])")
_NUM = re.compile(r"(?<![\w:.-])\d[\d,]*(?:\.\d+)?(?![\w:-])")


def value_tokens(text: str) -> set:
    """Clock times and plain numbers a statement asserts. Dates and numbers inside identifiers are ignored."""
    text = _DATE.sub(" ", text)
    tokens = {f"{int(h):02d}:{m}" for h, m in _TIME.findall(text)}
    stripped = _TIME.sub(" ", text)
    tokens |= {n.replace(",", "") for n in _NUM.findall(stripped)}
    return tokens


def ungrounded_tokens(claim: str, evidence_texts: Iterable[str]) -> set:
    """Values the claim states that none of its cited passages contain: the hallucination signal."""
    have = set()
    for e in evidence_texts:
        have |= value_tokens(e)
    return value_tokens(claim) - have


# ── conflicts, duplicates, parsing ──────────────────────────────────────────

def score_conflicts(truth: List[Dict], predicted: List[Dict]) -> Dict[str, float]:
    """
    truth: {class, values:[v1, v2]}; predicted: {class, values:[v1, v2]} (class from the field name, values normalised).
    A predicted conflict is correct when it joins the same two distinct values of a planted conflict.
    """
    def same_pair(t, p):
        if t["class"] != p["class"]:
            return False
        a, b = t["values"]
        x, y = p["values"]
        return (same_value(t["class"], a, x) and same_value(t["class"], b, y)) or (same_value(t["class"], a, y) and same_value(t["class"], b, x))

    tp = sum(1 for t in truth if any(same_pair(t, p) for p in predicted))
    correct_pred = sum(1 for p in predicted if any(same_pair(t, p) for t in truth))
    return prf(tp, len(predicted) - correct_pred, len(truth) - tp)


def score_log_parse(units: List[Dict], events: List[Dict]) -> Dict[str, float]:
    """Each true log line must be recovered with the right host, level and timestamp (clock time for legacy stamps)."""
    by_line = {}
    for u in units:
        by_line.setdefault(u["loc"].get("line"), u)
    ok = fp_raw = 0
    for e in events:
        u = by_line.get(e["line"])
        if e["kind"] == "raw":
            ok += bool(u and u.get("parseStatus") == "raw")  # junk must be kept, flagged raw, never dropped or "understood"
            continue
        if not u or u.get("parseStatus") == "raw":
            continue
        f, loc = u.get("fields", {}), u["loc"]
        host_ok = f.get("host") == e["host"]
        level_ok = e["level"] is None or f.get("level") == e["level"]
        ts = loc.get("ts") or ""
        ts_ok = ts.startswith(e["ts"][:19]) if "T" in (e["ts"] or "") else (e["ts"] or "") in ts
        ok += host_ok and level_ok and ts_ok
    return {"lines": len(events), "correct": ok, "accuracy": ok / len(events) if events else 1.0}
