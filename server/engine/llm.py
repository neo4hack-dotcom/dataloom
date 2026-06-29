"""
Local LLM client — OpenAI-compatible (Ollama, LM Studio, vLLM, llama.cpp…).

Inspired by DOINg.MCP: any server exposing `/v1/chat/completions` and `/v1/models`
works. The active configuration (base_url, api_key, model, temperature, max_tokens)
is held module-side and refreshed by the API from the persisted settings, so the
agent/explore call-sites stay config-free.

Public surface kept stable for callers:
  is_up() · list_models() · generate(prompt, system, model, json_mode) ·
  complete_text(prompt, system, model) · embed(text) · test(cfg) · configure(cfg)

Everything degrades gracefully: connection failures raise nothing in is_up()
(returns False) and generate() returns {"_raw": ...} so callers fall back to
heuristics. A `localhost` base transparently falls back to `127.0.0.1`.
"""
from __future__ import annotations

import json
import re
import time
import httpx
from typing import Any

# Default = Ollama's OpenAI-compatible endpoint.
DEFAULT_CONFIG: dict[str, Any] = {
    "base_url": "http://127.0.0.1:11434/v1",
    "api_key": "",
    "model": "qwen2.5-coder:7b",
    "temperature": 0.2,
    "max_tokens": 2048,
}

# Quick-start presets surfaced in the UI.
PRESETS = [
    {"name": "Ollama", "base_url": "http://127.0.0.1:11434/v1"},
    {"name": "LM Studio", "base_url": "http://127.0.0.1:1234/v1"},
    {"name": "vLLM", "base_url": "http://127.0.0.1:8000/v1"},
    {"name": "llama.cpp", "base_url": "http://127.0.0.1:8080/v1"},
]

_CONFIG: dict[str, Any] = dict(DEFAULT_CONFIG)


# --------------------------------------------------------------------------- #
#  Configuration                                                              #
# --------------------------------------------------------------------------- #
def configure(cfg: dict[str, Any] | None) -> None:
    """Merge a (partial) config into the active one. Called by the API."""
    if not cfg:
        return
    for k in ("base_url", "api_key", "model", "temperature", "max_tokens"):
        if k in cfg and cfg[k] is not None:
            _CONFIG[k] = cfg[k]


def current_config(redact: bool = True) -> dict[str, Any]:
    out = dict(_CONFIG)
    if redact:
        out["api_key_set"] = bool(out.get("api_key"))
        out.pop("api_key", None)
    return out


def _effective(cfg: dict[str, Any] | None) -> dict[str, Any]:
    if not cfg:
        return _CONFIG
    merged = dict(_CONFIG)
    merged.update({k: v for k, v in cfg.items() if v is not None})
    return merged


# --------------------------------------------------------------------------- #
#  HTTP plumbing (with localhost → 127.0.0.1 fallback)                        #
# --------------------------------------------------------------------------- #
_LOCALHOST_RE = re.compile(r"^(https?://)localhost(\b.*)$", re.IGNORECASE)
_CONNECT_ERRORS = (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadError,
                   httpx.RemoteProtocolError)


def _base(cfg: dict[str, Any]) -> str:
    return (cfg.get("base_url") or "").strip().rstrip("/")


def _headers(cfg: dict[str, Any]) -> dict[str, str]:
    h = {"Content-Type": "application/json"}
    if cfg.get("api_key"):
        h["Authorization"] = f"Bearer {cfg['api_key']}"
    return h


def _candidate_bases(base: str) -> list[str]:
    cands = [base]
    m = _LOCALHOST_RE.match(base)
    if m:
        cands.append(m.group(1) + "127.0.0.1" + m.group(2))
    return cands


def _send(method: str, cfg: dict[str, Any], suffix: str, **kwargs) -> httpx.Response:
    base = _base(cfg)
    if not base:
        raise RuntimeError("LLM base URL not configured")
    last: Exception | None = None
    for b in _candidate_bases(base):
        try:
            return httpx.request(method, b + suffix, headers=_headers(cfg), **kwargs)
        except _CONNECT_ERRORS as exc:
            last = exc
            continue
    raise RuntimeError(f"LLM unreachable at {base} ({last})")


# --------------------------------------------------------------------------- #
#  Health & models                                                           #
# --------------------------------------------------------------------------- #
def is_up(timeout: float = 1.5, cfg: dict[str, Any] | None = None) -> bool:
    try:
        r = _send("GET", _effective(cfg), "/models", timeout=timeout)
        return r.status_code == 200
    except Exception:
        return False


def list_models(cfg: dict[str, Any] | None = None) -> list[str]:
    try:
        r = _send("GET", _effective(cfg), "/models", timeout=8.0)
        r.raise_for_status()
        data = r.json()
        return sorted(m.get("id", "") for m in data.get("data", []) if m.get("id"))
    except Exception:
        return []


# --------------------------------------------------------------------------- #
#  Chat completions                                                          #
# --------------------------------------------------------------------------- #
def _chat(messages: list[dict[str, str]], *, cfg: dict[str, Any] | None = None,
          model: str | None = None, temperature: float | None = None,
          max_tokens: int | None = None, json_mode: bool = False,
          timeout: float = 120.0) -> str:
    c = _effective(cfg)
    payload: dict[str, Any] = {
        "model": model or c.get("model") or "default",
        "messages": messages,
        "temperature": c.get("temperature", 0.2) if temperature is None else temperature,
        "max_tokens": max_tokens or int(c.get("max_tokens") or 2048),
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    try:
        r = _send("POST", c, "/chat/completions", json=payload, timeout=timeout)
        r.raise_for_status()
    except httpx.HTTPStatusError as exc:
        # Some servers/models reject response_format — retry once without it.
        if json_mode and exc.response.status_code in (400, 404, 422):
            payload.pop("response_format", None)
            r = _send("POST", c, "/chat/completions", json=payload, timeout=timeout)
            r.raise_for_status()
        else:
            raise
    return r.json()["choices"][0]["message"]["content"] or ""


def parse_json_loose(text: str) -> Any:
    """Tolerant JSON parse for local models (strips <think>, fences, repairs commas)."""
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


def generate(prompt: str, system: str = "", model: str | None = None,
             json_mode: bool = True, timeout: float = 120.0) -> dict[str, Any] | str:
    """JSON completion (default). Returns parsed dict, or {"_raw": text} on parse miss."""
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    try:
        text = _chat(messages, model=model, json_mode=json_mode, timeout=timeout)
    except Exception:
        return {} if json_mode else ""
    if not json_mode:
        return text
    parsed = parse_json_loose(text)
    return parsed if parsed else {"_raw": text}


def complete_text(prompt: str, system: str = "", model: str | None = None,
                  temperature: float = 0.3, timeout: float = 120.0) -> str:
    """Plain-text completion — used by the conversational copilot."""
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    return _chat(messages, model=model, temperature=temperature, timeout=timeout)


def embed(text: str, model: str | None = None, timeout: float = 30.0) -> list[float]:
    """Best-effort embeddings via the OpenAI-compatible /embeddings endpoint."""
    c = _effective(None)
    try:
        r = _send("POST", c, "/embeddings", timeout=timeout,
                  json={"model": model or c.get("model"), "input": text})
        r.raise_for_status()
        return r.json()["data"][0]["embedding"]
    except Exception:
        return []


# --------------------------------------------------------------------------- #
#  Connection test                                                           #
# --------------------------------------------------------------------------- #
def test(cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    """Ping the model with a tiny prompt. Returns {ok, latency_ms, message, ts}."""
    c = _effective(cfg)
    start = time.time()
    try:
        reply = _chat(
            [{"role": "system", "content": "Reply with the single word OK."},
             {"role": "user", "content": "ping"}],
            cfg=c, max_tokens=8, timeout=30.0)
        return {
            "ok": True,
            "latency_ms": round((time.time() - start) * 1000, 1),
            "message": f"Model “{c.get('model') or '(default)'}” is operational — reply: {reply.strip()[:40]}",
            "ts": time.time(),
        }
    except httpx.HTTPStatusError as exc:
        return {"ok": False, "latency_ms": round((time.time() - start) * 1000, 1),
                "message": f"HTTP {exc.response.status_code}: {exc.response.text[:160]}",
                "ts": time.time()}
    except Exception as exc:
        return {"ok": False, "latency_ms": round((time.time() - start) * 1000, 1),
                "message": str(exc), "ts": time.time()}
