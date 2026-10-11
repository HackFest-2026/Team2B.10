"""Stay off the network once the models are on disk.

sentence-transformers asks huggingface.co for metadata every time a model loads, even when it is cached.
On an on-prem deployment that is an outbound call. This module (imported before any model library) turns
the Hugging Face hub into offline mode when every model the worker needs is already in the local cache.
First run, with an empty cache, still downloads; HF_HUB_OFFLINE=0|1 set explicitly always wins.
"""
import os

REQUIRED_MODELS = ("sentence-transformers/all-MiniLM-L6-v2", os.getenv("NLI_MODEL", "cross-encoder/nli-deberta-v3-small"), os.getenv("RERANK_MODEL", "cross-encoder/ms-marco-MiniLM-L-6-v2"))


def _cache_dir() -> str:
    hub = os.getenv("HF_HUB_CACHE") or os.path.join(os.getenv("HF_HOME") or os.path.expanduser("~/.cache/huggingface"), "hub")
    return hub


def models_cached() -> bool:
    root = _cache_dir()
    return all(os.path.isdir(os.path.join(root, "models--" + name.replace("/", "--"), "snapshots")) for name in REQUIRED_MODELS)


def apply() -> bool:
    """Returns True when offline mode is in effect."""
    if "HF_HUB_OFFLINE" not in os.environ and models_cached():
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    return os.environ.get("HF_HUB_OFFLINE") == "1"


OFFLINE = apply()
