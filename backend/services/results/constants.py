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

# Race status values persisted on rider results.
RACE_STATUS_FIN: Final[str] = "FIN"
RACE_STATUS_DNF: Final[str] = "DNF"
RACE_STATUS_WC: Final[str] = "WC"
