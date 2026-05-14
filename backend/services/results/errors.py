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


class EventInfoFetchError(ResultsProcessingError):
    """Raised when event metadata cannot be fetched/resolved."""


class FinishSegmentResolutionError(ResultsProcessingError):
    """Raised when deterministic finish segment resolution fails."""


class StartTimeParseError(ResultsProcessingError):
    """Raised when subgroup start time cannot be parsed."""
