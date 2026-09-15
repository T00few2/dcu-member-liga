"""Quality checks for Zwift power-profile best efforts.

Zwift's `cpBestEfforts.pointsWatts` reports the mean power over the best window
of each length. A trainer glitch that emits a brief spike therefore leaks into
every window long enough to contain it: the spike's work is divided across the
window, so a 3-second artefact still shows up as a 5-second "best effort".
"""

from __future__ import annotations

import logging
import math

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


def clean_durations_above(
    points: dict[int, float],
    duration: int,
    min_marginal_ratio: float = DEFAULT_MIN_MARGINAL_RATIO,
) -> list[int]:
    """Durations longer than `duration` whose own values are not padded, ascending."""
    return sorted(
        d for d in points
        if d > duration and not is_padded_effort(points, d, min_marginal_ratio)
    )


def corrected_watts(
    points: dict[int, float],
    duration: int,
    min_marginal_ratio: float = DEFAULT_MIN_MARGINAL_RATIO,
) -> float | None:
    """Estimate the real best effort at `duration` when the reported one is padded.

    A power-duration curve is close to a straight line in log-log space over a
    narrow span, so the two shortest uncontaminated points give a local decay
    exponent to extrapolate back down to `duration`. Only those two are used:
    fitting the whole curve drags in the aerobic tail and badly oversteepens the
    slope at sprint durations.

    The result is then clamped between two bounds that hold by construction:

    - It cannot exceed the reported value, which is a maximum taken over every
      window of that length — the spike included.
    - It cannot fall below the best effort at the next clean duration, because a
      longer maximal window always contains a shorter window at least as hard.

    Returns None when no clean longer point exists, which leaves the caller
    nothing to anchor on.
    """
    reported = points.get(duration)
    if not reported or reported <= 0:
        return None

    anchors = clean_durations_above(points, duration, min_marginal_ratio)
    if not anchors:
        return None

    floor = points[anchors[0]]
    if len(anchors) < 2:
        estimate = floor
    else:
        d1, d2 = anchors[0], anchors[1]
        p1, p2 = points[d1], points[d2]
        # Positive for a normally decaying curve; <= 0 falls through to the floor.
        exponent = math.log(p1 / p2) / math.log(d2 / d1)
        estimate = p1 * (d1 / duration) ** exponent

    return min(max(estimate, floor), reported)
