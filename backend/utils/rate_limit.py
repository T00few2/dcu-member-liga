"""Small in-process limiter for public endpoints."""

from __future__ import annotations

import time
from collections import defaultdict, deque

_hits: dict[str, deque[float]] = defaultdict(deque)


def allow(key: str, limit: int, window_seconds: int) -> bool:
    now = time.monotonic()
    bucket = _hits[key]
    cutoff = now - window_seconds
    while bucket and bucket[0] <= cutoff:
        bucket.popleft()
    if len(bucket) >= limit:
        return False
    bucket.append(now)
    return True


def client_ip() -> str:
    from flask import request

    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip() or "unknown"
    return request.remote_addr or "unknown"
