import threading
from typing import List
from sentence_transformers import SentenceTransformer

# Load model once at module level (downloaded on first run, cached after)
print("Loading embedding model (all-MiniLM-L6-v2)...")
model = SentenceTransformer("all-MiniLM-L6-v2")
print("✅ Embedding model loaded")


# Several documents are ingested concurrently, each embedding from its own thread. Concurrent
# encode() calls on one torch model crashed the worker process, so they are serialised.
_encode_lock = threading.Lock()


def embed_texts(texts: List[str]) -> List[List[float]]:
    """Embed a list of texts using local sentence-transformers model."""
    with _encode_lock:
        embeddings = model.encode(texts, convert_to_numpy=True, show_progress_bar=False)
    return embeddings.tolist()


def embed_single(text: str) -> List[float]:
    results = embed_texts([text])
    return results[0]
