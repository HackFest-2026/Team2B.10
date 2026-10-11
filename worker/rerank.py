"""Cross-encoder reranker: scores how well each passage answers a question, reading both together.

Embedding search ranks by overall topical similarity, which puts a figure caption that repeats a query word next to
the paragraph that actually answers it. A cross-encoder reads (question, passage) jointly and separates them.
"""
import math
import os
import threading
from typing import List

from sentence_transformers import CrossEncoder

MODEL_NAME = os.getenv("RERANK_MODEL", "cross-encoder/ms-marco-MiniLM-L-6-v2")
MAX_PASSAGE_CHARS = 700

_lock = threading.Lock()
_model = None


def _load():
    global _model
    if _model is None:
        _model = CrossEncoder(MODEL_NAME)
    return _model


def rerank(query: str, passages: List[str]) -> List[float]:
    """Relevance in 0..1 for each passage (sigmoid of the model's logit)."""
    if not passages:
        return []
    with _lock:
        model = _load()
        logits = model.predict([(query, p[:MAX_PASSAGE_CHARS]) for p in passages], show_progress_bar=False)
    return [1 / (1 + math.exp(-float(x))) for x in logits]
