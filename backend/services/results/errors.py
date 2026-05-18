from __future__ import annotations

from typing import Any


class ResultsProcessingError(Exception):
    """Base class for expected race results processing failures."""

    def __init__(self, message: str, context: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.context = context or {}

    def __str__(self) -> str:
        if not self.context:
            return self.message
        context_bits = ", ".join(f"{k}={v!r}" for k, v in sorted(self.context.items()))
        return f"{self.message} ({context_bits})"


class FatalResultsError(ResultsProcessingError):
    """Processing cannot continue — missing data or invalid configuration.

    Raise when no partial results are possible and the caller should surface
    the error to the user immediately (e.g. no event IDs linked, race not
    found, database unavailable).
    """


class RecoverableResultsError(ResultsProcessingError):
    """One item (subgroup / event source) failed; processing can continue.

    These are caught inside the processor loop and logged.  Subclasses should
    be raised only when it is safe to skip the failing item and carry on with
    the remaining ones.
    """


# ── Concrete fatal errors ─────────────────────────────────────────────────────

class RaceNotFoundError(FatalResultsError):
    """The requested race document does not exist in Firestore."""


class ConfigurationError(FatalResultsError):
    """Race configuration is missing required data (e.g. no event IDs)."""


# ── Concrete recoverable errors ───────────────────────────────────────────────

class EventInfoFetchError(RecoverableResultsError):
    """Raised when event metadata cannot be fetched/resolved."""


class FinishSegmentResolutionError(RecoverableResultsError):
    """Raised when deterministic finish segment resolution fails."""


class StartTimeParseError(RecoverableResultsError):
    """Raised when subgroup start time cannot be parsed."""
