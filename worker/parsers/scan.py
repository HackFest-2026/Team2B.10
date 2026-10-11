"""Turns page data from pdf_processor.extract_page_data into EUs (one per text block / OCR paragraph)."""
from typing import Dict, List

from .common import ParseResult, make_unit

LOW_CONFIDENCE = 60
MIN_UNIT_CHARS = 2


def units_from_pages(pages: List[Dict]) -> ParseResult:
    result = ParseResult(page_count=len(pages))
    weighted, words, low, empty_pages = 0.0, 0, 0, []

    for page in pages:
        count_before = len(result.units)
        for index, block in enumerate(page["blocks"], start=1):
            text = block["text"]
            if len(text.strip()) < MIN_UNIT_CHARS:
                continue
            x0, y0, x1, y1 = (round(v, 1) for v in block["bbox"])
            conf = block.get("conf")
            loc = {"page": page["pageNumber"], "block": index, "bbox": [x0, y0, x1, y1]}
            fields = {"ocr": True} if block.get("ocr") else {}
            if block.get("agreement") is not None:
                fields["ocrAgreement"] = block["agreement"]
            unit = make_unit(text, loc, fields, confidence=conf)
            if conf is not None:
                n = len(text.split())
                weighted += conf * n
                words += n
                if conf < LOW_CONFIDENCE:
                    low += 1
                    unit["fields"]["lowConfidence"] = True
            result.units.append(unit)
        if len(result.units) == count_before:
            empty_pages.append(page["pageNumber"])

    if words:
        result.ocr_confidence = round(weighted / words, 1)
    if low:
        unstable = sum(1 for u in result.units if u["fields"].get("ocrAgreement", 1) < 0.9)
        result.warnings.append(f"{low} OCR paragraphs have low confidence (<{LOW_CONFIDENCE}%) and are flagged"
                               + (f"; {unstable} came out differently when the page was read at a second resolution, so the text is unreliable" if unstable else ""))
    if empty_pages:
        shown = ", ".join(str(p) for p in empty_pages[:10])
        result.warnings.append(f"No text could be extracted from page(s) {shown}{'…' if len(empty_pages) > 10 else ''}")
    return result
