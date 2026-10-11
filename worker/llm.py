import os
import re
import json
import requests

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434").rstrip("/")
MODEL = os.getenv("LLM_MODEL", "qwen3:14b")
TIMEOUT = int(os.getenv("LLM_TIMEOUT_S", "300"))


def chat_completion(system_prompt: str, user_message: str, json_mode: bool = False) -> str:
    """Chat completion against the local Ollama server. Nothing leaves the network."""
    payload = {
        "model": MODEL,
        "stream": False,
        "think": False,  # Qwen3: skip the reasoning trace
        "options": {"temperature": 0.2, "num_ctx": int(os.getenv("LLM_NUM_CTX", "8192"))},
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
    }
    if json_mode:
        payload["format"] = "json"
        # Structured extraction must be short. A text full of numbers (a results table) can send the model into a
        # 2,000-token list that takes minutes; past the cap the JSON is cut off, fails to parse, and the batch is skipped.
        payload["options"]["num_predict"] = int(os.getenv("LLM_JSON_MAX_TOKENS", "1000"))
    response = requests.post(f"{OLLAMA_URL}/api/chat", json=payload, timeout=TIMEOUT)
    response.raise_for_status()
    text = response.json()["message"]["content"]
    return re.sub(r"<think>[\s\S]*?</think>", "", text).strip()


def generate_insight_and_highlights(paragraph: str) -> dict:
    """
    Given a paragraph, generate an insight and highlight phrases.
    Returns: {"insight": "...", "highlights": ["phrase1", "phrase2"]}
    """
    system = (
        "You are a research analyst. Given a paragraph from a document, "
        "you must return a JSON object with two fields:\n"
        "1. 'insight': A 2-3 sentence analysis of the paragraph's key finding or contribution.\n"
        "2. 'highlights': An array of 1-3 exact verbatim phrases from the paragraph that are most important.\n"
        "CRITICAL: The phrases in 'highlights' must be EXACT substrings of the input paragraph.\n"
        "Return ONLY valid JSON, no markdown, no extra text."
    )
    try:
        raw = chat_completion(system, f"Paragraph:\n{paragraph}", json_mode=True)
        return json.loads(raw)
    except Exception as e:
        print(f"LLM insight error: {e}")
        return {"insight": "Could not generate insight.", "highlights": []}
