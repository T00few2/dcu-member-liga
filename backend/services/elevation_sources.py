"""Alternate elevation stream sources when Strava segment streams are unavailable."""

from __future__ import annotations

import logging
import re
from typing import Any

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

_WOW_HEADERS = {
    "User-Agent": "DCU-Member-Liga/1.0 (+elevation profile fallback)",
    "Accept": "text/html,application/xhtml+xml",
}


def _slugify(value: str | None) -> str:
    text = (value or "").strip().lower().replace("&", " and ")
    text = re.sub(r"['\"]", "", text)
    text = re.sub(r"[^\w\s-]", " ", text)
    text = re.sub(r"\s+", "-", text)
    text = re.sub(r"-+", "-", text)
    return text.strip("-")


def _parse_axis_labels(
    svg,
) -> tuple[float, float, float, float, float, float, float, float] | None:
    """
    Return (x0_px, x1_px, dist0_m, dist1_m, y_alt0_px, y_alt1_px, alt0, alt1).

    What's on Zwift elevation charts use:
      x: left → 0 km, right → route distance
      y: lower text "0 m", upper text max altitude
    """
    texts = svg.find_all("text")
    x_labels: list[tuple[float, float]] = []  # (x_px, distance_m)
    y_labels: list[tuple[float, float]] = []  # (y_px, altitude_m)

    km_re = re.compile(r"^([\d.]+)\s*km$", re.I)
    m_re = re.compile(r"^([\d.]+)\s*m$", re.I)

    for t in texts:
        label = (t.get_text() or "").strip()
        try:
            x = float(t.get("x"))
            y = float(t.get("y"))
        except (TypeError, ValueError):
            continue

        km_m = km_re.match(label)
        if km_m:
            x_labels.append((x, float(km_m.group(1)) * 1000.0))
            continue
        m_m = m_re.match(label)
        if m_m:
            # Axis altitude labels sit left of the plot; ignore segment captions lower down.
            if y > 235:
                continue
            y_labels.append((y, float(m_m.group(1))))

    if len(x_labels) < 2 or len(y_labels) < 2:
        return None

    x_labels.sort(key=lambda p: p[0])
    y_labels.sort(key=lambda p: p[1])  # by altitude meters
    x0_px, dist0 = x_labels[0]
    x1_px, dist1 = x_labels[-1]
    # Lowest altitude label is near bottom (higher y); highest altitude near top (lower y)
    y_labels_by_alt = sorted(y_labels, key=lambda p: p[1])
    y_alt0_px, alt0 = y_labels_by_alt[0]
    y_alt1_px, alt1 = y_labels_by_alt[-1]

    if x1_px <= x0_px or dist1 <= dist0:
        return None
    if abs(y_alt1_px - y_alt0_px) < 1e-6:
        return None

    return x0_px, x1_px, dist0, dist1, y_alt0_px, y_alt1_px, alt0, alt1


def _polyline_pairs(points_attr: str) -> list[tuple[float, float]]:
    raw = (points_attr or "").replace(",", " ").split()
    nums: list[float] = []
    for tok in raw:
        try:
            nums.append(float(tok))
        except ValueError:
            continue
    pairs = list(zip(nums[0::2], nums[1::2]))
    # Drop exact duplicate consecutive points
    out: list[tuple[float, float]] = []
    for p in pairs:
        if not out or out[-1] != p:
            out.append(p)
    return out


def fetch_whatsonzwift_elevation_streams(world_slug: str, route_slug: str) -> dict[str, Any] | None:
    """
    Scrape What's on Zwift route page elevation SVG into Strava-like streams.

    Returns {'distance': [m...], 'altitude': [m...]} or None.
    """
    world = _slugify(world_slug)
    route = _slugify(route_slug)
    if not world or not route:
        return None

    url = f"https://whatsonzwift.com/world/{world}/route/{route}"
    try:
        res = requests.get(url, headers=_WOW_HEADERS, timeout=30)
    except Exception as e:
        logger.warning("What's on Zwift request failed for %s/%s: %s", world, route, e)
        return None

    if res.status_code != 200:
        logger.warning(
            "What's on Zwift HTTP %s for %s/%s", res.status_code, world, route
        )
        return None

    soup = BeautifulSoup(res.text, "html.parser")
    best_pairs: list[tuple[float, float]] = []
    best_axes = None

    for svg in soup.find_all("svg"):
        polys = svg.find_all("polyline")
        if not polys:
            continue
        axes = _parse_axis_labels(svg)
        if not axes:
            continue
        # Longest polyline is the elevation profile line
        candidate = max((_polyline_pairs(p.get("points") or "") for p in polys), key=len, default=[])
        if len(candidate) > len(best_pairs):
            best_pairs = candidate
            best_axes = axes

    if not best_pairs or not best_axes:
        logger.warning("No elevation polyline found on %s", url)
        return None

    x0_px, x1_px, dist0, dist1, y_alt0_px, y_alt1_px, alt0, alt1 = best_axes

    distance: list[float] = []
    altitude: list[float] = []
    for x_px, y_px in best_pairs:
        dist_m = dist0 + (x_px - x0_px) / (x1_px - x0_px) * (dist1 - dist0)
        alt_m = alt0 + (y_px - y_alt0_px) / (y_alt1_px - y_alt0_px) * (alt1 - alt0)
        distance.append(round(float(dist_m), 2))
        altitude.append(round(float(alt_m), 2))

    if len(distance) < 10:
        return None

    # Ensure monotonic-ish distance (keep first of plateau, drop backwards noise)
    cleaned_d: list[float] = [distance[0]]
    cleaned_a: list[float] = [altitude[0]]
    for d, a in zip(distance[1:], altitude[1:]):
        if d + 0.01 < cleaned_d[-1]:
            continue
        if abs(d - cleaned_d[-1]) < 0.01 and abs(a - cleaned_a[-1]) < 0.05:
            continue
        cleaned_d.append(d)
        cleaned_a.append(a)

    return {"distance": cleaned_d, "altitude": cleaned_a}
