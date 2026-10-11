import re
from typing import List, Dict, Optional, Tuple

try:
    import fitz  # PyMuPDF
except Exception:
    fitz = None


def normalize_whitespace(text: str) -> str:
    """Collapse multiple whitespace chars into single space."""
    return re.sub(r'\s+', ' ', text).strip()


def find_phrase_in_blocks(phrase: str, blocks: List[Dict]) -> Optional[Dict]:
    """
    Find the first block whose text contains the phrase (after normalization).
    Returns the block's bbox or None.
    """
    norm_phrase = normalize_whitespace(phrase).lower()

    for block in blocks:
        block_text = normalize_whitespace(block.get("text", "")).lower()
        if norm_phrase in block_text:
            return block.get("bbox")

    # Fallback: try partial match (first 30 chars)
    if len(norm_phrase) > 30:
        partial = norm_phrase[:30]
        for block in blocks:
            block_text = normalize_whitespace(block.get("text", "")).lower()
            if partial in block_text:
                return block.get("bbox")

    return None


STOPWORDS = {
    "the", "a", "an", "and", "or", "but", "if", "then", "else", "for", "to", "of",
    "in", "on", "at", "by", "with", "from", "as", "is", "are", "was", "were", "be",
    "been", "being", "this", "that", "these", "those", "it", "its", "their", "his", "her",
    "our", "your", "we", "you", "they", "he", "she", "not", "than", "into", "about",
}


def _keyword_fallback(phrase: str, max_keywords: int = 3) -> List[str]:
    words = re.findall(r"[A-Za-z0-9][A-Za-z0-9\-_/]*", phrase.lower())
    ranked = [w for w in words if len(w) >= 4 and w not in STOPWORDS]
    seen = set()
    result = []
    for word in ranked:
        if word in seen:
            continue
        seen.add(word)
        result.append(word)
        if len(result) >= max_keywords:
            break
    return result


def _search_phrase_on_page(phrase: str, page) -> List[Dict]:
    if not phrase or not page or not fitz:
        return []

    normalized = normalize_whitespace(phrase)
    candidates = [normalized]
    if len(normalized) > 140:
        candidates.append(normalized[:140])

    search_flags = 0
    if hasattr(fitz, "TEXT_DEHYPHENATE"):
        search_flags |= fitz.TEXT_DEHYPHENATE
    if hasattr(fitz, "TEXT_PRESERVE_WHITESPACE"):
        search_flags |= fitz.TEXT_PRESERVE_WHITESPACE

    for candidate in candidates:
        try:
            rects = page.search_for(candidate, flags=search_flags)
        except Exception:
            rects = []

        if rects:
            return [
                {
                    "text": phrase,
                    "bbox": {
                        "x0": rect.x0,
                        "y0": rect.y0,
                        "x1": rect.x1,
                        "y1": rect.y1,
                    },
                }
                for rect in rects
            ]

    # Keyword fallback: still precise, but narrower than paragraph-level boxes.
    for keyword in _keyword_fallback(normalized):
        try:
            rects = page.search_for(keyword, flags=search_flags)
        except Exception:
            rects = []
        if rects:
            return [
                {
                    "text": keyword,
                    "bbox": {
                        "x0": rect.x0,
                        "y0": rect.y0,
                        "x1": rect.x1,
                        "y1": rect.y1,
                    },
                }
                for rect in rects[:2]
            ]

    return []


def map_highlights_to_bboxes(highlights: List[str], page_blocks: List[Dict], page=None) -> List[Dict]:
    """
    For each highlight phrase, find its bounding box in the page blocks.
    Returns list of {text, bbox} dicts.
    """
    results = []
    for phrase in highlights:
        phrase = (phrase or "").strip()
        if not phrase:
            continue

        # Preferred path: exact in-page text search for sentence/keyword precision.
        if page is not None:
            precise_hits = _search_phrase_on_page(phrase, page)
            if precise_hits:
                results.extend(precise_hits)
            continue

        # Backward-compatible fallback when page object is unavailable.
        bbox = find_phrase_in_blocks(phrase, page_blocks)
        if bbox:
            results.append({
                "text": phrase,
                "bbox": {
                    "x0": bbox[0],
                    "y0": bbox[1],
                    "x1": bbox[2],
                    "y1": bbox[3],
                },
            })
    return results
