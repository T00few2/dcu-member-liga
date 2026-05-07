"""
Compatibility facade for dual recording internals.

Phase 2 refactor moved implementation into focused modules under
`services/dual_recording/*`; this file re-exports the same helper symbols so
existing imports remain stable.
"""

from services.dual_recording.strava import (  # noqa: F401
    _compute_strava_power_curve,
    _extract_stream,
    _match_strava_activity,
    _trim_strava_streams,
)
from services.dual_recording.time_series import (  # noqa: F401
    _compute_avg_power_diff,
    _compute_best_efforts,
    _mask_streams,
    _mse_sync_offset,
    _parse_iso_utc,
    _resample_to_1hz,
)
from services.dual_recording.verdict import (  # noqa: F401
    _build_cp_comparison,
    _check_dr_pass,
)
from services.dual_recording.workflows import (  # noqa: F401
    _compute_dual_recording_for_rider,
    _is_dual_recording_required,
    _run_dr_verification_background,
)
from services.dual_recording.zwift import (  # noqa: F401
    _extract_zwift_activity_fields,
    _fetch_zwift_streams,
    _parse_binary_fit_url,
    _parse_json_fit_streams,
)
