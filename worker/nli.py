"""Local natural-language-inference model used to check that a claim follows from its cited evidence."""
import os
import threading
from typing import Dict, List, Tuple

from sentence_transformers import CrossEncoder

MODEL_NAME = os.getenv("NLI_MODEL", "cross-encoder/nli-deberta-v3-small")
MAX_PREMISE_CHARS = 1500

_lock = threading.Lock()
_model = None


def _load():
    global _model
    if _model is None:
        _model = CrossEncoder(MODEL_NAME)
    return _model


def entail(pairs: List[Tuple[str, str]]) -> List[Dict[str, float]]:
    """pairs: (premise, hypothesis) -> probabilities for entailment / contradiction / neutral."""
    with _lock:  # one torch model, serialised like the embedder
        model = _load()
        labels = {int(i): name.lower() for i, name in model.model.config.id2label.items()}
        scores = model.predict([(p[:MAX_PREMISE_CHARS], h) for p, h in pairs], apply_softmax=True, show_progress_bar=False)
    return [{labels[i]: float(row[i]) for i in range(len(row))} for row in scores]
