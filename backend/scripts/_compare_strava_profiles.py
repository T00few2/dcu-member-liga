"""One-off: Sauce route profiles versus cached Strava streams."""

from __future__ import annotations

import os
import sys

import json

import firebase_admin
from firebase_admin import credentials, firestore

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.sauce_elevation import route_elevation


def _ascent(alts):
    return sum(max(0.0, alts[i] - alts[i - 1]) for i in range(1, len(alts)))


def _resample(dist, alt, n=120):
    if len(dist) < 2:
        return []
    end = dist[-1] or 1
    out = []
    j = 1
    for i in range(n):
        target = end * i / (n - 1)
        while j < len(dist) - 1 and dist[j] < target:
            j += 1
        span = dist[j] - dist[j - 1] or 1
        t = (target - dist[j - 1]) / span
        out.append(alt[j - 1] + (alt[j] - alt[j - 1]) * t)
    return out


def _corr(a, b):
    n = min(len(a), len(b))
    if n < 3:
        return None
    a = a[:n]
    b = b[:n]
    ma = sum(a) / n
    mb = sum(b) / n
    num = sum((a[i] - ma) * (b[i] - mb) for i in range(n))
    da = sum((x - ma) ** 2 for x in a) ** 0.5
    db = sum((x - mb) ** 2 for x in b) ** 0.5
    if da == 0 or db == 0:
        return None
    return num / (da * db)


def main():
    catalog_path = os.path.join(os.path.dirname(__file__), "_route_strava.json")
    catalog = json.loads(open(catalog_path, encoding="utf-8").read())
    by_strava = {str(row["strava"]): row for row in catalog}

    sa = os.path.join(os.path.dirname(__file__), "..", "serviceAccountKey.json")
    firebase_admin.initialize_app(credentials.Certificate(os.path.abspath(sa)))
    db = firestore.client()
    print(f"{'route':<28} {'corr':>6} {'sauceKm':>8} {'stravaKm':>8} {'sauceAsc':>8} {'stravaAsc':>9} leadin")
    for doc in db.collection("elevation_cache").stream():
        match = by_strava.get(doc.id)
        if not match:
            print(f"{doc.id:<28} no zwift-data route")
            continue
        route_id = match["id"]
        name = match["name"]
        data = doc.to_dict() or {}
        s_dist = data.get("distance") or []
        s_alt = data.get("altitude") or []
        if len(s_dist) < 2:
            continue
        lap = route_elevation(route_id, include_leadin=False)
        both = route_elevation(route_id, include_leadin=True)
        if not lap["distance"]:
            print(f"{name:<28} no sauce route {route_id}")
            continue

        def score(profile):
            return abs(profile["distance"][-1] - s_dist[-1])

        chosen = both if both["distance"] and score(both) < score(lap) else lap
        lead = "yes" if chosen is both else "no"
        corr = _corr(_resample(chosen["distance"], chosen["altitude"]), _resample(s_dist, s_alt))
        print(
            f"{name[:28]:<28} {corr:6.3f} {chosen['distance'][-1]/1000:8.2f} "
            f"{s_dist[-1]/1000:8.2f} {_ascent(chosen['altitude']):8.0f} {_ascent(s_alt):9.0f} {lead}"
        )


if __name__ == "__main__":
    main()
