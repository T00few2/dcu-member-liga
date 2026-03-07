from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Dict, Optional

from flask import Request
from firebase_admin import auth

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AuthzError(Exception):
    message: str
    status_code: int = 401


def _get_bearer_token(request: Request) -> str:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise AuthzError("Missing or invalid Authorization header", 401)
    token = auth_header.split("Bearer ", 1)[1].strip()
    if not token:
        raise AuthzError("Missing bearer token", 401)
    return token


def verify_user_token(request: Request) -> Dict[str, Any]:
    """
    Verify Firebase ID token and return decoded claims.
    """
    token = _get_bearer_token(request)
    try:
        decoded = auth.verify_id_token(token)
        return decoded
    except Exception as exc:
        logger.warning(f"Token verification failed: {exc}")
        raise AuthzError("Unauthorized", 401)


def require_admin(request: Request) -> Dict[str, Any]:
    """
    Require a valid Firebase ID token that includes the custom claim: admin == True.
    """
    decoded = verify_user_token(request)
    if decoded.get("admin") is not True:
        raise AuthzError("Forbidden", 403)
    return decoded

