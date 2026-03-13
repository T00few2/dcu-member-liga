"""
Generic thread-safe TTL cache for services that require periodic re-authentication
(e.g. ZwiftPower sessions, Zwift API tokens).

Usage:
    from services.cached_service import CachedService

    def _make_zwift():
        svc = ZwiftService(username, password)
        try:
            svc.authenticate()
        except Exception as e:
            logger.error(f"Zwift auth failed: {e}")
        return svc  # return even on failure; callers handle downstream errors

    def _validate_zwift(svc) -> bool:
        svc.ensure_valid_token()  # raises if expired
        return True

    _zwift_cache = CachedService(
        factory=_make_zwift,
        name='Zwift',
        ttl=SESSION_TTL_SECONDS,
        validator=_validate_zwift,
    )

    def get_zwift_service():
        return _zwift_cache.get()
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Callable, Generic, Optional, TypeVar

T = TypeVar('T')

logger = logging.getLogger(__name__)

# Default session TTL: 50 minutes, matching Zwift / ZwiftPower token lifetime.
DEFAULT_TTL: int = 3000


class CachedService(Generic[T]):
    """
    Thread-safe singleton cache with TTL and optional liveness validation.

    - factory()     : creates (and optionally authenticates) the service.
                      May return an unauthenticated instance on failure so
                      callers receive a usable object that fails gracefully.
    - validator(svc): called on cache hits to verify the cached instance is
                      still live. Raise any exception or return False to
                      trigger a refresh.
    - ttl           : seconds before the cached instance is unconditionally
                      recreated (regardless of validator).
    """

    def __init__(
        self,
        factory: Callable[[], T],
        name: str = 'Service',
        ttl: int = DEFAULT_TTL,
        validator: Optional[Callable[[T], bool]] = None,
    ) -> None:
        self._factory = factory
        self._name = name
        self._ttl = ttl
        self._validator = validator
        self._instance: Optional[T] = None
        self._timestamp: float = 0.0
        self._lock = threading.Lock()

    def get(self) -> T:
        """Return a valid cached instance, refreshing if necessary."""
        now = time.time()
        with self._lock:
            # Try the cached instance first.
            if self._instance is not None and (now - self._timestamp < self._ttl):
                if self._validator is None:
                    return self._instance
                try:
                    if self._validator(self._instance):
                        return self._instance
                except Exception:
                    pass  # Validator failed — fall through to refresh.

            # Create a fresh instance.
            logger.info(f"Creating new {self._name} session.")
            instance = self._factory()
            self._instance = instance
            self._timestamp = time.time()
            return instance

    def invalidate(self) -> None:
        """Force the next call to get() to create a fresh instance."""
        with self._lock:
            self._instance = None
            self._timestamp = 0.0

    @property
    def cached(self) -> Optional[T]:
        """Return the raw cached value without refreshing (may be None or stale)."""
        return self._instance

    def __repr__(self) -> str:
        age = time.time() - self._timestamp if self._timestamp else float('inf')
        return (
            f"CachedService(name={self._name!r}, ttl={self._ttl}s, "
            f"has_instance={self._instance is not None}, age={age:.0f}s)"
        )
