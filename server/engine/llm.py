"""
Local LLM client (Ollama).

Thin, dependency-light wrapper over the Ollama HTTP API for:
  - generate(): JSON-mode completion used by the documenter / QA / search agents
  - embed():    name/definition embeddings used to boost semantic similarity

Everything degrades gracefully: if Ollama is unreachable the agents fall back to
deterministic heuristics so the app is always usable offline.
"""
from __future__ import annotations

import json
import httpx
from typing import Any

OLLAMA_URL = "http://localhost:11434"
DEFAULT_MODEL = "qwen2.5-coder:7b"
EMBED_MODEL = "qwen2.5-coder:7b"


def is_up(timeout: float = 1.0) -> bool:
    try:
        r = httpx.get(f"{OLLAMA_URL}/api/tags", timeout=timeout)
        return r.status_code == 200
    except Exception:
        return False


def list_models() -> list[str]:
    try:
        r = httpx.get(f"{OLLAMA_URL}/api/tags", timeout=2.0)
        return [m["name"] for m in r.json().get("models", [])]
    except Exception:
        return []


def generate(prompt: str, system: str = "", model: str | None = None,
             json_mode: bool = True, timeout: float = 120.0) -> dict[str, Any] | str:
    """Single-shot generation. Returns parsed JSON dict when json_mode, else text."""
    payload: dict[str, Any] = {
        "model": model or DEFAULT_MODEL,
        "prompt": prompt,
        "system": system,
        "stream": False,
        "options": {"temperature": 0.2, "num_ctx": 8192},
    }
    if json_mode:
        payload["format"] = "json"
    r = httpx.post(f"{OLLAMA_URL}/api/generate", json=payload, timeout=timeout)
    r.raise_for_status()
    text = r.json().get("response", "")
    if not json_mode:
        return text
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # best-effort: extract first {...} block
        start, end = text.find("{"), text.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(text[start:end + 1])
            except json.JSONDecodeError:
                pass
        return {"_raw": text}


def embed(text: str, model: str | None = None, timeout: float = 30.0) -> list[float]:
    try:
        r = httpx.post(f"{OLLAMA_URL}/api/embeddings",
                       json={"model": model or EMBED_MODEL, "prompt": text},
                       timeout=timeout)
        r.raise_for_status()
        return r.json().get("embedding", [])
    except Exception:
        return []
