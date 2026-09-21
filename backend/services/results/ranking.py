"""Shared ranking helpers for league / season place assignment."""
from __future__ import annotations


def competition_places(scores: dict[str, int] | list[tuple[str, int]]) -> dict[str, int]:
    """
    Standard competition ranking (1224): equal scores share the same 1-based place;
    the next distinct score skips by the size of the tied group.

    Higher score ranks better. Used so declassified riders who share last-place
    league/GC points also share the same seasonal place and prestige points.
    """
    if isinstance(scores, dict):
        items = list(scores.items())
    else:
        items = list(scores)

    ranked = sorted(items, key=lambda item: (-int(item[1]), str(item[0])))
    places: dict[str, int] = {}
    i = 0
    while i < len(ranked):
        current = int(ranked[i][1])
        j = i + 1
        while j < len(ranked) and int(ranked[j][1]) == current:
            j += 1
        place = i + 1
        for k in range(i, j):
            places[str(ranked[k][0])] = place
        i = j
    return places
