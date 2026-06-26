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
import re
import httpx
from typing import Any

OLLAMA_URL = "http://localhost:11434"
DEFAULT_MODEL = "qwen2.5-coder:7b"
EMBED_MODEL = "qwen2.5-coder:7b"


def parse_json_loose(text: str) -> Any:
    """
    Tolerant JSON parse for local models. Strips <think> reasoning blocks and
    markdown fences, isolates the first JSON object/array, repairs trailing commas.
    Returns {} on total failure rather than raising — callers fall back to heuristics.
    """
    if not text:
        return {}
    cleaned = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
    fence = re.search(r"```(?:json)?\s*(.*?)```", cleaned, flags=re.DOTALL)
    if fence:
        cleaned = fence.group(1)
    cleaned = cleaned.strip()
    for candidate in (cleaned, text):
        try:
            return json.loads(candidate)
        except (ValueError, TypeError):
            pass
    for open_ch, close_ch in (("{", "}"), ("[", "]")):
        start, end = cleaned.find(open_ch), cleaned.rfind(close_ch)
        if 0 <= start < end:
            snippet = cleaned[start:end + 1]
            for attempt in (snippet, re.sub(r",\s*([}\]])", r"\1", snippet)):
                try:
                    return json.loads(attempt)
                except ValueError:
                    continue
    return {}


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
    parsed = parse_json_loose(text)
    return parsed if parsed else {"_raw": text}


def complete_text(prompt: str, system: str = "", model: str | None = None,
                  temperature: float = 0.3, timeout: float = 120.0) -> str:
    """Plain-text completion (no JSON mode) — used by the conversational copilot."""
    payload: dict[str, Any] = {
        "model": model or DEFAULT_MODEL,
        "prompt": prompt,
        "system": system,
        "stream": False,
        "options": {"temperature": temperature, "num_ctx": 8192},
    }
    r = httpx.post(f"{OLLAMA_URL}/api/generate", json=payload, timeout=timeout)
    r.raise_for_status()
    return r.json().get("response", "").strip()


def embed(text: str, model: str | None = None, timeout: float = 30.0) -> list[float]:
    try:
        r = httpx.post(f"{OLLAMA_URL}/api/embeddings",
                       json={"model": model or EMBED_MODEL, "prompt": text},
                       timeout=timeout)
        r.raise_for_status()
        return r.json().get("embedding", [])
    except Exception:
        return []
