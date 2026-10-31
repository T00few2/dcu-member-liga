"""Check Sauce road height against published segment grades. Diagnostic only."""

from __future__ import annotations

import json
import math
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "data"


def dist3(a, b) -> float:
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)


def catmull(p0, p1, p2, p3, t: float):
    t2 = t * t
    t3 = t2 * t
    return [
        0.5
        * (
            2 * p1[i]
            + (-p0[i] + p2[i]) * t
            + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2
            + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3
        )
        for i in range(3)
    ]


def spline_samples(path, looped: bool, samples: int = 12):
    """Return (arc_cm, point) along the Catmull-Rom spline, arc starting at 0."""
    n = len(path)
    spans = n if looped else max(0, n - 1)
    out = [(0.0, path[0][:3])]
    cursor = 0.0
    prev = path[0][:3]
    for i in range(spans):
        if looped:
            pts = [path[(i + k) % n][:3] for k in (-1, 0, 1, 2)]
        else:
            pts = [path[min(n - 1, max(0, i + k))][:3] for k in (-1, 0, 1, 2)]
        for step in range(1, samples + 1):
            point = catmull(pts[0], pts[1], pts[2], pts[3], step / samples)
            cursor += dist3(prev, point)
            out.append((cursor, point))
            prev = point
    return out


def point_at(table, arc_cm: float):
    if arc_cm <= 0:
        return table[0][1]
    if arc_cm >= table[-1][0]:
        return table[-1][1]
    lo, hi = 0, len(table) - 1
    while lo + 1 < hi:
        mid = (lo + hi) // 2
        if table[mid][0] < arc_cm:
            lo = mid
        else:
            hi = mid
    a0, p0 = table[lo]
    a1, p1 = table[hi]
    span = a1 - a0 or 1
    u = (arc_cm - a0) / span
    return [p0[i] + (p1[i] - p0[i]) * u for i in range(3)]


def window_stats(table, start_cm: float, end_cm: float, step_cm: float = 2000):
    """Net and accumulated ascent in metres. step_cm is along the spline."""
    forward = end_cm >= start_cm
    length = abs(end_cm - start_cm)
    steps = max(2, int(length / step_cm))
    alts = []
    for i in range(steps + 1):
        arc = start_cm + (end_cm - start_cm) * (i / steps)
        alts.append(point_at(table, arc)[2] / 100.0)
    asc = 0.0
    horiz = 0.0
    # horizontal is approximated by spline step projected later; use spline length
    for i in range(1, len(alts)):
        dz = alts[i] - alts[i - 1]
        if dz > 0:
            asc += dz
    net = alts[-1] - alts[0]
    length_m = length / 100.0
    grade = (net / length_m * 100.0) if length_m else None
    return {
        "length_m": round(length_m, 1),
        "net_m": round(net, 1),
        "asc_m": round(asc, 1),
        "grade": round(grade, 2) if grade is not None else None,
        "forward": forward,
    }


def best_window(table, length_m: float, target_net_m: float):
    total = table[-1][0]
    length_cm = length_m * 100
    if length_cm >= total:
        return None
    step = max(length_cm / 20, 5000)
    best = None
    arc = 0.0
    while arc + length_cm <= total:
        stats = window_stats(table, arc, arc + length_cm, step_cm=2500)
        err = abs(stats["net_m"] - target_net_m)
        if best is None or err < best[0]:
            best = (err, arc / total, stats)
        arc += step
    return best


def main():
    roads = {
        r["id"]: r
        for r in json.loads((DATA / "worlds" / "1" / "roads.json").read_text(encoding="utf-8"))
    }
    segs = json.loads((DATA / "worlds" / "1" / "segments.json").read_text(encoding="utf-8"))
    wanted = {
        "Titans Grove KOM": 59.4,
        "Alpe du Zwift": 1036,
        "Epic KOM": 413,
        "Zwift KOM": 51,
        "The Grade": None,
    }
    for seg in segs:
        name = (seg.get("nameForward") or "").strip()
        if name not in wanted:
            continue
        road = roads[seg["roadId"]]
        table = spline_samples(road["path"], bool(road.get("looped")))
        total_m = table[-1][0] / 100
        start = float(seg["roadStartForward"])
        finish = float(seg["roadFinish"])
        stats = window_stats(table, start * table[-1][0], finish * table[-1][0])
        print(f"\n{name} spline_len={total_m:.0f}m sauce_dist={seg.get('distanceForward')} looped={road.get('looped')} spline={road.get('splineType')}")
        print("  percent window", stats)
        target = wanted[name]
        if target:
            found = best_window(table, float(seg["distanceForward"]), target)
            if found:
                err, pct, st = found
                print(f"  closest {seg.get('distanceForward')}m window to {target}m net: err={err:.1f} at percent {pct:.3f} {st}")


if __name__ == "__main__":
    main()
