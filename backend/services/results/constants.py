from __future__ import annotations

from typing import Final

# Fetch modes used by results refresh pipeline.
FETCH_MODE_FINISHERS: Final[str] = "finishers"
FETCH_MODE_LIVE: Final[str] = "live"

# Public category filter value that means "no category filter".
CATEGORY_FILTER_ALL: Final[str] = "All"

# Results lifecycle phases.
RESULTS_PHASE_PROVISIONAL: Final[str] = "provisional"
RESULTS_PHASE_FINALIZED: Final[str] = "finalized"

# Live-race provisional refresh defaults.
DEFAULT_PROVISIONAL_REFRESH_SECONDS: Final[int] = 30
# Server-side floor on poll interval to protect the processor from misconfigured
# (or maliciously edited) Firestore values.
MIN_PROVISIONAL_REFRESH_SECONDS: Final[int] = 10
# Hard ceiling on how long after race start we keep auto-refreshing, even if
# the admin configured a longer windowDurationMinutes. Matches the 4h
# auto-activation horizon in _auto_activate_if_due.
MAX_LIVE_RACE_WINDOW_MINUTES: Final[int] = 240

# Race status values persisted on rider results.
RACE_STATUS_FIN: Final[str] = "FIN"
RACE_STATUS_DNF: Final[str] = "DNF"
RACE_STATUS_WC: Final[str] = "WC"
