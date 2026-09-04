"""
Auth — bcrypt password hashing, opaque session tokens, roles.

Sessions are persisted in the store (survive server restarts) and resolved by
a FastAPI middleware in main.py, which attaches the resolved user to
`request.state.user`. No JWT / external auth provider — this is a small,
single-process local app.
"""
from __future__ import annotations

import secrets
from typing import Any

import bcrypt

ADMIN = "admin"
MEMBER = "member"
VIEWER = "viewer"
ROLES = (ADMIN, MEMBER, VIEWER)

# Non-GET requests a viewer (read-only) role may still make — asking the local
# LLM a question and searching are "navigating the platform", not editing it.
VIEWER_WRITE_ALLOWLIST = {"/api/search", "/api/llm/copilot", "/api/auth/logout"}


def viewer_write_allowed(path: str) -> bool:
    # marking a notification read is a per-user UI action, not a catalog edit
    return path in VIEWER_WRITE_ALLOWLIST or path.startswith("/api/notifications/")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except Exception:
        return False


def create_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """Tokens (e.g. the MCP API token) are hashed the same way as passwords."""
    return bcrypt.hashpw(token.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_token(token: str, token_hash: str) -> bool:
    return verify_password(token, token_hash)


def public_user(user: dict[str, Any]) -> dict[str, Any]:
    """Strip the password hash before a user record ever leaves the server."""
    return {k: v for k, v in user.items() if k != "password_hash"}
