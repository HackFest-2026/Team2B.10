import os
import re
import uuid
import shutil
import asyncio
import tempfile
import logging
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))  # before any module reads os.getenv; real env vars win
import offline  # noqa: F401  (must come before any model library)
import fitz
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from pdf_processor import (
    extract_page_data,
    select_important_paragraphs,
    annotate_pdf,
)
from embeddings import embed_texts
from llm import chat_completion, generate_insight_and_highlights
from entities import extract_mentions
from render import render_pdf
from facts import extract_facts, label_events
from highlight_mapper import map_highlights_to_bboxes
from parsers import IngestError, extension_of, is_page_based, parse_file, units_from_pages

logging.basicConfig(
    level=os.getenv('WORKER_LOG_LEVEL', 'INFO'),
    format='[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s',
)
logger = logging.getLogger('worker')

app = FastAPI(title="Mirage Worker")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o for o in os.getenv("CORS_ORIGINS", "").split(",") if o],  # worker is internal-only; no browser origins by default
    allow_methods=["*"],
    allow_headers=["*"],
)

TEMP_DIR = tempfile.gettempdir()
STORAGE_DIR = os.path.abspath(os.getenv("STORAGE_DIR", os.path.join(os.path.dirname(__file__), "..", "storage")))
os.makedirs(STORAGE_DIR, exist_ok=True)
STORAGE_KEY_RE = re.compile(r"^[a-f0-9]{32}\.[a-z0-9]{1,8}$")
INSIGHT_CONCURRENCY = int(os.getenv("INSIGHT_CONCURRENCY", "2"))  # tune per LLM rate limit
MAX_UNITS = int(os.getenv("MAX_UNITS", "20000"))
# Per-paragraph PDF highlights cost one model call per paragraph. The analysis/report pipeline does not need them.
GENERATE_INSIGHTS = os.getenv("GENERATE_INSIGHTS", "1") != "0"
logger.info("Hugging Face hub: %s", "OFFLINE (models are cached, no outbound calls)" if offline.OFFLINE else "online (models not cached yet: first run downloads them)")
logger.info("Insight generation (Ollama call per key paragraph on PDFs and scans): %s",
            "ON" if GENERATE_INSIGHTS else "OFF (GENERATE_INSIGHTS=0): PDFs will not get highlights or notes")
IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "tif", "tiff"}


class ProcessRequest(BaseModel):
    documentId: str
    projectId: str
    storageKey: str
    filename: str = ""
    sourceType: str = "report"
    insights: bool | None = None  # None: the GENERATE_INSIGHTS default



async def _generate_insight_for_para(para: dict, semaphore: asyncio.Semaphore) -> dict:
    """
    Run one LLM call inside a semaphore slot so we don't overwhelm the LLM.
    generate_insight_and_highlights is a blocking function, so we offload it
    to a thread via asyncio.to_thread() — keeps the event loop free.
    """
    async with semaphore:
        logger.info('generating insight for page=%s', para.get('pageNumber'))
        try:
            llm_result = await asyncio.to_thread(
                generate_insight_and_highlights, para["text"]
            )
        except Exception as e:
            logger.warning('LLM failed for page=%s: %s', para.get('pageNumber'), e)
            return None

        return {
            "pageNumber": para["pageNumber"],
            "insightText": llm_result.get("insight", ""),
            "rawHighlights": llm_result.get("highlights", []),
        }



async def _embed_all(texts):
    """Batch embed in groups of 32, offloaded to a thread."""
    embeddings = []
    for i in range(0, len(texts), 32):
        embeddings.extend(await asyncio.to_thread(embed_texts, texts[i:i + 32]))
    return embeddings


async def _attach_embeddings(units):
    if len(units) > MAX_UNITS:
        raise IngestError(f"Source has {len(units)} units, above the limit of {MAX_UNITS}")
    for unit, vector in zip(units, await _embed_all([u["text"] for u in units])):
        unit["embedding"] = vector


@app.post("/process")
async def process_document(req: ProcessRequest):
    """Ingest one stored source into Evidence Units (+ insights for page-based sources)."""
    logger.info('[%s] process start type=%s file=%s', req.documentId, req.sourceType, req.filename)
    if not STORAGE_KEY_RE.match(req.storageKey):
        raise HTTPException(status_code=400, detail="invalid storageKey")
    source_path = os.path.join(STORAGE_DIR, req.storageKey)
    if not os.path.isfile(source_path):
        raise HTTPException(status_code=404, detail="source file not found in storage")
    filename = req.filename or req.storageKey

    try:
        if is_page_based(req.sourceType, filename):
            return await _process_pages(req, source_path, filename)
        return await _process_text_source(req, source_path, filename)
    except HTTPException:
        raise
    except IngestError as e:
        logger.warning('[%s] ingest rejected: %s', req.documentId, e)
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.exception('[%s] ERROR: %s', req.documentId, e)
        raise HTTPException(status_code=500, detail=str(e))


async def _process_text_source(req: ProcessRequest, source_path: str, filename: str):
    """Text reports, DOCX, conversation logs and system logs: parse -> units -> embeddings."""
    parsed = await asyncio.to_thread(parse_file, source_path, req.sourceType, filename)
    if not parsed.units:
        raise IngestError("No extractable content found in this file")
    await _attach_embeddings(parsed.units)
    logger.info('[%s] parsed %d units, %d warnings', req.documentId, len(parsed.units), len(parsed.warnings))
    return {
        "pageCount": None,
        "insights": [],
        "annotatedStorageKey": None,
        "units": parsed.units,
        "ocrConfidence": None,
        "warnings": parsed.warnings,
    }


async def _process_pages(req: ProcessRequest, source_path: str, filename: str):
    """PDFs and scanned images: text layer or OCR -> units, insights, annotated PDF."""
    tmp_input = os.path.join(TEMP_DIR, f"{req.documentId}_original.pdf")
    tmp_output = os.path.join(TEMP_DIR, f"{req.documentId}_annotated.pdf")

    try:
        # ── Step 1: Stage the original (images are wrapped into a one-page PDF) ──
        try:
            if extension_of(filename) in IMAGE_EXTENSIONS:
                with fitz.open(source_path) as image_doc:
                    pdf_bytes = image_doc.convert_to_pdf()
                with open(tmp_input, "wb") as f:
                    f.write(pdf_bytes)
            else:
                with fitz.open(source_path) as probe:
                    if probe.needs_pass:
                        raise IngestError("PDF is password protected")
                shutil.copyfile(source_path, tmp_input)
        except IngestError:
            raise
        except Exception as e:
            raise IngestError(f"Could not open file as a PDF or image: {e}")

        # ── Step 2: Extract text + bounding boxes ────────────────────────
        logger.info('[%s] Extracting text...', req.documentId)
        pages = await asyncio.to_thread(extract_page_data, tmp_input)
        page_count = len(pages)
        parsed = units_from_pages(pages)
        if not parsed.units:
            raise IngestError("No text could be extracted (the file may be blank or unreadable)")
        await _attach_embeddings(parsed.units)

        # ── Step 3: Select important paragraphs ──────────────────────────
        logger.info('[%s] Selecting key paragraphs...', req.documentId)
        important_paragraphs = select_important_paragraphs(pages) if (GENERATE_INSIGHTS if req.insights is None else req.insights) else []
        logger.info('[%s] selected %d paragraphs for insight', req.documentId, len(important_paragraphs))

        # ── Steps 4 & 5: Generate insights concurrently ──────────────────
        logger.info('[%s] Generating %d insights concurrently (concurrency=%d)...',
                    req.documentId, len(important_paragraphs), INSIGHT_CONCURRENCY)

        page_blocks_map = {p["pageNumber"]: p["blocks"] for p in pages}
        semaphore = asyncio.Semaphore(INSIGHT_CONCURRENCY)

        # Fire all LLM calls at once, capped by semaphore
        insight_tasks = [
            _generate_insight_for_para(para, semaphore)
            for para in important_paragraphs
        ]
        insights_unordered = await asyncio.gather(*insight_tasks)

        # Re-sort by page number to maintain document order
        # A paragraph whose model call failed (None) or came back empty must not become an empty claim node.
        generated = [i for i in insights_unordered if i and (i.get("insightText") or "").strip()]
        if len(generated) < len(insights_unordered):
            logger.warning('[%s] dropped %d of %d insights (model call failed or empty)',
                           req.documentId, len(insights_unordered) - len(generated), len(insights_unordered))
        insights = sorted(generated, key=lambda x: x["pageNumber"])

        # Map raw highlight phrases to precise bbox coordinates using PDF text search
        with fitz.open(tmp_input) as pdf_doc:
            for insight in insights:
                page_number = insight.get("pageNumber", 0)
                raw_highlights = insight.pop("rawHighlights", [])

                if page_number < 1 or page_number > len(pdf_doc):
                    insight["highlights"] = []
                    continue

                page = pdf_doc[page_number - 1]
                page_blocks = page_blocks_map.get(page_number, [])
                insight["highlights"] = map_highlights_to_bboxes(
                    raw_highlights,
                    page_blocks,
                    page=page,
                )

        # ── Step 6: Annotate PDF ──────────────────────────────────────────
        logger.info('[%s] Annotating PDF...', req.documentId)
        await asyncio.to_thread(annotate_pdf, tmp_input, insights, tmp_output)

        # ── Store annotated PDF in the shared storage volume ──────────────
        annotated_key = f"{uuid.uuid4().hex}.pdf"
        shutil.copyfile(tmp_output, os.path.join(STORAGE_DIR, annotated_key))

        # ── Step 7: Return results ────────────────────────────────────────
        logger.info('[%s] processing complete pageCount=%s units=%s insights=%s',
                    req.documentId, page_count, len(parsed.units), len(insights))

        return {
            "pageCount": page_count,
            "insights": insights,
            "annotatedStorageKey": annotated_key,
            "units": parsed.units,
            "ocrConfidence": parsed.ocr_confidence,
            "warnings": parsed.warnings,
        }

    finally:
        for path in [tmp_input, tmp_output]:
            try:
                if os.path.exists(path):
                    os.remove(path)
            except Exception:
                pass



class ExtractUnit(BaseModel):
    id: str
    text: str
    sourceType: str = ""
    fields: dict = {}
    llm: bool = True  # False: patterns and structured fields only (the backend decided this unit is not worth a model call)


class ExtractRequest(BaseModel):
    units: list[ExtractUnit]


@app.post("/extract")
async def extract(req: ExtractRequest):
    """Entity mentions for a batch of units (patterns + structured fields + verified LLM NER)."""
    if len(req.units) > 200:
        raise HTTPException(status_code=413, detail="at most 200 units per call")
    payload = [u.model_dump() for u in req.units]
    mentions = await asyncio.to_thread(extract_mentions, payload, chat_completion)
    return {"results": [{"id": u.id, "mentions": m} for u, m in zip(req.units, mentions)]}


class FactRequest(BaseModel):
    units: list[ExtractUnit]
    knownFields: list[str] = []


@app.post("/extract-facts")
async def extract_unit_facts(req: FactRequest):
    """Verified (subject, field, value) facts per unit; reuses and grows the project's field vocabulary."""
    if len(req.units) > 100:
        raise HTTPException(status_code=413, detail="at most 100 units per call")
    facts, vocabulary, gaps = await asyncio.to_thread(extract_facts, [u.text for u in req.units], req.knownFields, chat_completion)
    return {"results": [{"id": u.id, "facts": f, "gaps": g} for u, f, g in zip(req.units, facts, gaps)], "vocabulary": vocabulary}


class EventItem(BaseModel):
    id: str
    text: str
    host: str = ""


class LabelRequest(BaseModel):
    events: list[EventItem]
    milestones: list[str]


@app.post("/label-events")
async def label_log_events(req: LabelRequest):
    """Which prose-derived milestone (if any) each log event marks. Only the label comes from the model."""
    if len(req.events) > 200:
        raise HTTPException(status_code=413, detail="at most 200 events per call")
    labels = await asyncio.to_thread(label_events, [e.model_dump() for e in req.events], req.milestones, chat_completion)
    return {"results": [{"id": e.id, "milestone": label} for e, label in zip(req.events, labels)]}


class NliPair(BaseModel):
    premise: str
    hypothesis: str


class NliRequest(BaseModel):
    pairs: list[NliPair]


@app.post("/nli")
async def nli(req: NliRequest):
    """Does each hypothesis follow from its premise? Probabilities from a local NLI model."""
    if len(req.pairs) > 200:
        raise HTTPException(status_code=413, detail="at most 200 pairs per call")
    from nli import entail  # imported lazily: the model is only loaded when first needed
    scores = await asyncio.to_thread(entail, [(p.premise, p.hypothesis) for p in req.pairs])
    return {"results": scores}


class RerankRequest(BaseModel):
    query: str
    passages: list[str]


@app.post("/rerank")
async def rerank_passages(req: RerankRequest):
    """Relevance (0..1) of each passage to the query, from a local cross-encoder."""
    if len(req.passages) > 100:
        raise HTTPException(status_code=413, detail="at most 100 passages per call")
    from rerank import rerank  # lazy: the model loads on first use
    scores = await asyncio.to_thread(rerank, req.query, req.passages)
    return {"scores": scores}


class RenderRequest(BaseModel):
    spec: dict


@app.post("/render-pdf")
async def render(req: RenderRequest):
    """Render a verified document spec to a PDF in the shared storage volume."""
    key = f"{uuid.uuid4().hex}.pdf"
    try:
        pages = await asyncio.to_thread(render_pdf, req.spec, os.path.join(STORAGE_DIR, key))
    except KeyError as e:
        raise HTTPException(status_code=422, detail=f"render spec is missing {e}")
    return {"storageKey": key, "pages": pages}


class EmbedManyRequest(BaseModel):
    texts: list[str]


@app.post("/embed-many")
async def embed_many(req: EmbedManyRequest):
    if len(req.texts) > 500:
        raise HTTPException(status_code=413, detail="at most 500 texts per call")
    return {"embeddings": await asyncio.to_thread(embed_texts, req.texts)}


class EmbedRequest(BaseModel):
    text: str


@app.post("/embed")
async def embed_text(req: EmbedRequest):
    """Generate embedding for a single text using local model."""
    try:
        embedding = (await asyncio.to_thread(embed_texts, [req.text]))[0]
        return {"embedding": embedding}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
def health():
    return {"status": "ok"}
