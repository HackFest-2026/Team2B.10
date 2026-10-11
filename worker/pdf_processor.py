import fitz  # PyMuPDF
import pytesseract
from PIL import Image
import io
import os
import math
import tempfile
from typing import List, Dict, Tuple
from collections import Counter
import re

MIN_TEXT_DENSITY = 50  # chars per page minimum before OCR fallback


# ── Text Extraction ──────────────────────────────────────────────────────────

def extract_page_data(pdf_path: str) -> List[Dict]:
    """
    Extract text blocks with bounding boxes from each page.
    Falls back to Tesseract OCR for low-density pages.
    Returns: [{pageNumber, blocks: [{text, bbox}]}]
    """
    doc = fitz.open(pdf_path)
    pages = []

    for page_num, page in enumerate(doc, start=1):
        blocks_raw = page.get_text("blocks")  # (x0, y0, x1, y1, text, block_no, block_type)
        text_blocks = [
            {"text": b[4].strip(), "bbox": (b[0], b[1], b[2], b[3])}
            for b in blocks_raw
            if b[6] == 0 and b[4].strip()  # type 0 = text
        ]

        page_text = " ".join(b["text"] for b in text_blocks)

        # OCR fallback for sparse pages
        if len(page_text) < MIN_TEXT_DENSITY:
            ocr_blocks = _ocr_page(page)
            if ocr_blocks:
                text_blocks = ocr_blocks

        pages.append({"pageNumber": page_num, "blocks": text_blocks})

    doc.close()
    return pages


OCR_DPI = 300
VERIFY_DPI = 200      # a second, independent reading of the same page
AGREEMENT_MIN = 0.90  # below this the two readings disagree and the text cannot be trusted
LOW_CONFIDENCE = 60   # mean Tesseract word confidence (0-100) below which a paragraph is flagged


def _read_text(page: fitz.Page, dpi: int) -> str:
    zoom = dpi / 72
    img = Image.open(io.BytesIO(page.get_pixmap(matrix=fitz.Matrix(zoom, zoom)).tobytes("png")))
    return " ".join(pytesseract.image_to_string(img).split()).lower()


def ocr_agreement(first: str, second: str) -> float:
    """How closely two OCR readings of one page agree (1.0 = identical)."""
    import difflib
    return difflib.SequenceMatcher(None, first, second, autojunk=False).ratio() if (first or second) else 1.0


def _ocr_page(page: fitz.Page) -> List[Dict]:
    """
    Render page to an image and run Tesseract OCR.
    Returns paragraph-level blocks (not single words): [{text, bbox, conf, ocr: True}]
    with bbox in PDF points and conf = mean word confidence (0-100).
    """
    try:
        zoom = OCR_DPI / 72
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
        img = Image.open(io.BytesIO(pix.tobytes("png")))
        data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)

        paragraphs: Dict[Tuple[int, int], Dict] = {}
        for i, word in enumerate(data["text"]):
            word = word.strip()
            conf = float(data["conf"][i])
            if not word or conf < 0:  # conf == -1 marks layout rows, not words
                continue
            key = (data["block_num"][i], data["par_num"][i])
            x0, y0 = data["left"][i] / zoom, data["top"][i] / zoom
            x1, y1 = x0 + data["width"][i] / zoom, y0 + data["height"][i] / zoom
            para = paragraphs.setdefault(key, {"words": [], "confs": [], "box": [x0, y0, x1, y1]})
            para["words"].append(word)
            para["confs"].append(conf)
            box = para["box"]
            box[0], box[1], box[2], box[3] = min(box[0], x0), min(box[1], y0), max(box[2], x1), max(box[3], y1)

        blocks = [
            {
                "text": " ".join(p["words"]),
                "bbox": tuple(p["box"]),
                "conf": round(sum(p["confs"]) / len(p["confs"]), 1),
                "ocr": True,
            }
            for p in paragraphs.values()
        ]
        # Tesseract's own confidence is not enough: badly degraded scans were read as 80-90% "confident" while only
        # ~30% correct. Reading the page again at another resolution exposes that: stable text agrees with itself.
        agreement = ocr_agreement(" ".join(" ".join(b["text"].split()) for b in blocks).lower(), _read_text(page, VERIFY_DPI))
        for b in blocks:
            b["agreement"] = round(agreement, 3)
            if agreement < AGREEMENT_MIN:
                b["conf"] = min(b["conf"], round(agreement * 60, 1))  # forces the low-confidence flag
        return blocks
    except Exception as e:
        print(f"OCR error: {e}")
        return []


# ── Important Paragraph Selection ────────────────────────────────────────────

def _tfidf_score(text: str, all_texts: List[str]) -> float:
    """Simple TF-IDF score for a text against a corpus."""
    words = re.findall(r'\w+', text.lower())
    if not words:
        return 0.0
    tf = Counter(words)
    N = len(all_texts)
    score = 0.0
    for word, count in tf.items():
        tf_val = count / len(words)
        df = sum(1 for t in all_texts if word in t.lower())
        idf = math.log((N + 1) / (df + 1)) + 1
        score += tf_val * idf
    return score


def select_important_paragraphs(pages: List[Dict]) -> List[Dict]:
    """
    Select top paragraphs per page for insight generation.
    Returns: [{pageNumber, text, blocks}]
    """
    page_count = len(pages)
    all_texts = [b["text"] for p in pages for b in p["blocks"]]
    selected = []

    for page in pages:
        blocks = [b for b in page["blocks"] if len(b["text"].split()) > 15]
        if not blocks:
            blocks = page["blocks"][:2]  # fallback

        if page_count < 10:
            # Analyze all blocks
            candidates = blocks
        else:
            # Top 2 by TF-IDF
            scored = sorted(
                blocks,
                key=lambda b: _tfidf_score(b["text"], all_texts),
                reverse=True,
            )
            candidates = scored[:2]

        for block in candidates:
            selected.append({
                "pageNumber": page["pageNumber"],
                "text": block["text"],
                "blocks": page["blocks"],
            })

    return selected


# ── PDF Annotation ────────────────────────────────────────────────────────────

def annotate_pdf(original_path: str, insights: List[Dict], output_path: str):
    """
    Add highlight annotations to PDF for each insight's bboxes.
    insights: [{pageNumber, highlights: [{text, bbox: {x0,y0,x1,y1}}]}]
    
    IMPORTANT: Uses page.add_highlight_annot() to add annotations as metadata 
    objects that sit 'over' the text without flattening. Saves with clean=False 
    to preserve the original searchable text layer.
    """
    doc = fitz.open(original_path)

    for insight in insights:
        page_num = insight["pageNumber"] - 1  # 0-indexed
        if page_num < 0 or page_num >= len(doc):
            continue

        page = doc[page_num]
        for hl in insight.get("highlights", []):
            bbox = hl.get("bbox")
            if not bbox:
                continue
            try:
                # Create rectangle for the highlight area
                rect = fitz.Rect(bbox["x0"], bbox["y0"], bbox["x1"], bbox["y1"])
                
                # Add highlight annotation (sits above text as metadata)
                highlight = page.add_highlight_annot(rect)
                
                # Set yellow color with some transparency
                highlight.set_colors(stroke=[1, 0.8, 0])  # RGB yellow
                
                # Optional: set opacity for better visibility
                highlight.set_opacity(0.4)
                
                # Update the annotation to apply changes
                highlight.update()
            except Exception as e:
                print(f"Annotation error on page {page_num + 1}: {e}")

    # Save with options that preserve text layer and don't flatten
    # clean=False: Don't remove unused objects (preserves structure)
    # deflate=True: Compress streams for smaller file size
    # garbage=4: Maximum garbage collection (removes duplicate objects)
    # linear=False: Don't linearize (faster save for web viewing isn't needed here)
    doc.save(
        output_path,
        garbage=4,
        deflate=True,
        clean=False,
        pretty=False,
        linear=False,
    )
    doc.close()
