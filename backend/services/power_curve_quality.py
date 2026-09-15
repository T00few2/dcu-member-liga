"""Quality checks for Zwift power-profile best efforts.

Zwift's `cpBestEfforts.pointsWatts` reports the mean power over the best window
of each length. A trainer glitch that emits a brief spike therefore leaks into
every window long enough to contain it: the spike's work is divided across the
window, so a 3-second artefact still shows up as a 5-second "best effort".
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

#: A window's final seconds must carry at least this share of its own average
#: power. Real maximal efforts decay but keep pushing; padded ones go to zero.
DEFAULT_MIN_MARGINAL_RATIO = 0.25


def points_watts(power_curve: dict | None) -> dict[int, float]:
    """Flatten `cpBestEfforts.pointsWatts` into {duration_sec: watts}.

    Returns an empty mapping for any shape that is not the documented
    dict-of-duration-keys, so callers degrade to "cannot judge" rather than fail.
    """
    if not isinstance(power_curve, dict):
        return {}
    best_efforts = power_curve.get("cpBestEfforts")
    if not isinstance(best_efforts, dict):
        return {}
    raw = best_efforts.get("pointsWatts")
    if not isinstance(raw, dict):
        return {}

    points: dict[int, float] = {}
    for duration, point in raw.items():
        if not isinstance(point, dict):
            continue
        try:
            seconds = int(duration)
            watts = float(point.get("value"))
        except (TypeError, ValueError):
            continue
        if seconds > 0 and watts > 0:
            points[seconds] = watts
    return points


def marginal_watts(points: dict[int, float], duration: int) -> float | None:
    """Average power over the seconds that extend the next-shortest window.

    Work in a best-effort window is `duration * watts`, so the power added by
    lengthening the window from `prev` to `duration` is the difference in work
    divided by the seconds gained. None when there is no shorter point to
    compare against.
    """
    watts = points.get(duration)
    if not watts or watts <= 0:
        return None

    shorter = [d for d in points if 0 < d < duration]
    if not shorter:
        return None

    prev = max(shorter)
    return (duration * watts - prev * points[prev]) / (duration - prev)


def is_padded_effort(
    points: dict[int, float],
    duration: int,
    min_marginal_ratio: float = DEFAULT_MIN_MARGINAL_RATIO,
) -> bool:
    """True when the window's extra seconds carried almost no power.

    A rider finishing a maximal 5-second sprint is still producing most of their
    average in the final second. If that marginal power is near zero, the window
    is a short spike diluted across dead time and the reported average is not an
    effort of that length at all.

    Worked example from a real profile: 1s/2s/3s all exactly 1873W, 4s 1405W,
    5s 1124W. Work is flat at 5619-5620J from 3s onward, so seconds four and
    five contributed nothing and the "1124W 5s peak" is a 3-second artefact.
    """
    marginal = marginal_watts(points, duration)
    if marginal is None:
        return False
    return marginal < min_marginal_ratio * points[duration]
