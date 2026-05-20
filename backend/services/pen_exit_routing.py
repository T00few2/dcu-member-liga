"""Synthesize event lead-in manifest entries from pen-exit pathfinding."""

from __future__ import annotations

import copy
import json
import os
from typing import Any

from services.road_geometry import get_road, nearest_road_percent, road_segment_length


def _load_json(path: str) -> Any:
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def _is_paddock_road(road_id: int, intersections: list[dict[str, Any]]) -> bool:
    road_data = next((item for item in intersections if item.get("id") == road_id), None)
    return bool(road_data and road_data.get("roadIsPaddock"))


def _is_pen_exit_road(road_id: int, intersections: list[dict[str, Any]]) -> float | bool:
    road_data = next((item for item in intersections if item.get("id") == road_id), None)
    if road_data and road_data.get("paddockExitRoadTime") is not None:
        return road_data["paddockExitRoadTime"]
    return False


def _is_target_road(road_id: int, forward: bool, target_road_id: int, target_forward: bool) -> bool:
    return road_id == target_road_id and forward != target_forward


def _find_shortest_exit_path(
    start_road_id: int,
    start_forward: bool,
    target_road_id: int,
    target_forward: bool,
    intersections: list[dict[str, Any]],
    known_road_ids: set[int],
    route: dict[str, Any],
    world_id: int,
    base_dir: str,
) -> list[dict[str, Any]] | None:
    max_depth = 6
    max_non_paddock_roads = 4
    all_paths: list[list[dict[str, Any]]] = []

    course_id = route.get("courseId") or route.get("worldId")
    if course_id == 13 and start_road_id in {75, 81}:
        start_forward = False

    def explore(road_id: int, forward: bool, depth: int, current_path: list[dict[str, Any]], exit_time: float) -> None:
        if road_id not in known_road_ids:
            return
        if depth > max_depth:
            return
        if road_id == target_road_id and forward != target_forward:
            return

        non_paddock_roads = sum(
            1 for entry in current_path if not _is_paddock_road(entry["roadId"], intersections)
        )
        if non_paddock_roads > max_non_paddock_roads:
            return

        if exit_time == -1:
            current_rp = 0.0 if forward else 1.0
            exit_time = 0.0
        else:
            prev_road = get_road(world_id, current_path[-1]["roadId"], base_dir)
            next_road = get_road(world_id, road_id, base_dir)
            if not prev_road or not next_road:
                return
            current_rp = nearest_road_percent(prev_road, next_road, exit_time)

        duplicate = any(
            entry["roadId"] == road_id and entry["forward"] == forward and entry["exitTime"] == exit_time
            for entry in current_path
        )
        if duplicate:
            return

        path_copy = [dict(entry) for entry in current_path]
        if path_copy:
            path_copy[-1]["exitTime"] = exit_time
        path_copy.append(
            {
                "roadId": road_id,
                "forward": forward,
                "exitTime": exit_time,
                "entryTime": current_rp,
            }
        )

        if road_id == target_road_id and forward == target_forward:
            all_paths.append(copy.deepcopy(path_copy))
            return

        road_intersections = next((item for item in intersections if item.get("id") == road_id), None)
        if not road_intersections or not road_intersections.get("intersections"):
            return

        markers = sorted(
            road_intersections["intersections"],
            key=lambda marker: marker.get("m_roadTime1", 0),
            reverse=True,
        )
        if forward:
            valid_markers = [marker for marker in markers if marker.get("m_roadTime2", 0) > current_rp]
            direction_key = "forward"
        else:
            valid_markers = [marker for marker in markers if marker.get("m_roadTime1", 0) < current_rp]
            direction_key = "reverse"

        for marker in valid_markers:
            for option_wrapper in marker.get(direction_key, []):
                option = option_wrapper.get("option")
                if not option:
                    continue
                explore(
                    option["road"],
                    option["forward"],
                    depth + 1,
                    path_copy,
                    option["exitTime"],
                )

    explore(start_road_id, start_forward, 0, [], -1)
    if not all_paths:
        return None

    best_manifest: list[dict[str, Any]] | None = None
    best_distance = float("inf")
    for exit_path in all_paths:
        distance, manifest = _exit_path_distance(exit_path, route, world_id, base_dir)
        if distance < best_distance:
            best_distance = distance
            best_manifest = manifest

    if not best_manifest:
        return None

    for entry in best_manifest:
        entry["paddockExitRoadTime"] = _is_pen_exit_road(entry["roadId"], intersections)
        entry["isPaddockRoad"] = _is_paddock_road(entry["roadId"], intersections)
        entry["isTargetRoad"] = _is_target_road(
            entry["roadId"],
            not entry.get("reverse", False),
            target_road_id,
            target_forward,
        )
    return best_manifest


def _exit_path_distance(
    exit_path: list[dict[str, Any]],
    route: dict[str, Any],
    world_id: int,
    base_dir: str,
) -> tuple[float, list[dict[str, Any]]]:
    route_copy = copy.deepcopy(route)
    manifest: list[dict[str, Any]] = []
    first_manifest = route_copy["manifest"][0]

    for road in exit_path:
        skip_road = False
        if road["roadId"] == first_manifest["roadId"]:
            if road["forward"]:
                if (
                    (route_copy.get("courseId") or route_copy.get("worldId")) == 6
                    and road["roadId"] == 0
                    and (first_manifest.get("end") == 1 or route_copy["manifest"][1].get("end") == 1)
                ):
                    route_copy["manifest"].pop(0)
                    if route_copy["manifest"][0].get("end") == 1 and route_copy["manifest"][0].get("roadId") == 0:
                        route_copy["manifest"].pop(0)
                    if (
                        len(route_copy["manifest"]) > 1
                        and route_copy["manifest"][1].get("end") == 1
                        and route_copy["manifest"][0].get("roadId") == 0
                    ):
                        route_copy["manifest"].pop(1)
                    route_copy["manifest"][0]["start"] = road["entryTime"]
                    skip_road = True
                elif road["entryTime"] > first_manifest["start"] and road["entryTime"] > first_manifest["end"]:
                    manifest.extend(
                        [
                            {
                                "end": 1,
                                "start": road["entryTime"],
                                "reverse": False,
                                "roadId": road["roadId"],
                                "leadin": True,
                            },
                            {
                                "end": first_manifest["start"],
                                "start": 0,
                                "reverse": False,
                                "roadId": road["roadId"],
                                "leadin": True,
                            },
                        ]
                    )
                    break
                elif first_manifest["start"] < road["entryTime"] < first_manifest["end"]:
                    if route_copy.get("id") == 2007026433:
                        skip_road = True
                    elif first_manifest["start"] < road["entryTime"]:
                        route_copy["manifest"][0]["start"] = road["entryTime"]
                        skip_road = True
                    else:
                        road["exitTime"] = first_manifest["start"]
                else:
                    road["exitTime"] = first_manifest["start"]
            else:
                if first_manifest["start"] < road["entryTime"] < first_manifest["end"]:
                    route_copy["manifest"][0]["end"] = road["entryTime"]
                    skip_road = True
                else:
                    road["exitTime"] = first_manifest["end"]

        valid = (road["forward"] and road["entryTime"] < road["exitTime"]) or (
            not road["forward"] and road["exitTime"] < road["entryTime"]
        )
        if not skip_road and valid:
            manifest.append(
                {
                    "end": road["exitTime"] if road["forward"] else road["entryTime"],
                    "start": road["entryTime"] if road["forward"] else road["exitTime"],
                    "reverse": not road["forward"],
                    "roadId": road["roadId"],
                    "leadin": True,
                }
            )

    total_distance = 0.0
    for entry in manifest:
        road = get_road(world_id, entry["roadId"], base_dir)
        if road:
            total_distance += road_segment_length(road, entry["start"], entry["end"])
    return total_distance, manifest


def _build_leadin_entries(pen_exit_route: list[dict[str, Any]]) -> list[dict[str, Any]]:
    exit_roads = [entry for entry in pen_exit_route if entry.get("paddockExitRoadTime")]
    leadin: list[dict[str, Any]] = []

    if exit_roads:
        last_exit_road = exit_roads[-1]
        idx_exit_road = pen_exit_route.index(last_exit_road)
        manifest = pen_exit_route[idx_exit_road - 1 :]
        for idx in range(1, len(manifest)):
            entry = manifest[idx]
            leadin.append(
                {
                    "end": entry["end"],
                    "leadin": True,
                    "roadId": entry["roadId"],
                    "start": entry["paddockExitRoadTime"] or entry["start"],
                    "reverse": entry.get("reverse", False),
                }
            )
    else:
        first_non_paddock = next((entry for entry in pen_exit_route if not entry.get("isPaddockRoad")), None)
        if not first_non_paddock:
            return []
        idx_first = pen_exit_route.index(first_non_paddock)
        manifest = pen_exit_route[idx_first - 1 :]
        for idx in range(1, len(manifest)):
            entry = manifest[idx]
            leadin.append(
                {
                    "end": entry["end"],
                    "leadin": True,
                    "roadId": entry["roadId"],
                    "start": entry["start"],
                    "reverse": entry.get("reverse", False),
                }
            )
    return leadin


def _align_leadin_with_route_start(route: dict[str, Any]) -> None:
    leadin_entries = [entry for entry in route["manifest"] if entry.get("leadin")]
    if not leadin_entries:
        return

    last_leadin = leadin_entries[-1]
    idx_last_leadin = route["manifest"].index(last_leadin)
    if idx_last_leadin + 1 >= len(route["manifest"]):
        return

    next_entry = route["manifest"][idx_last_leadin + 1]
    if next_entry.get("roadId") != last_leadin.get("roadId"):
        return

    if last_leadin.get("reverse"):
        next_entry["end"] = last_leadin["start"]
    else:
        next_entry["start"] = last_leadin["end"]


def synthesize_leadin_entries(route: dict[str, Any], base_dir: str) -> list[dict[str, Any]]:
    """
    Return lead-in manifest entries for routes that have a lead-in distance but no
    explicit lead-in manifest data in Zwift's route JSON.
    """
    manifest = route.get("manifest") or []
    if any(entry.get("leadin") for entry in manifest):
        return []
    if float(route.get("leadinDistanceInMeters") or 0) <= 100:
        return []

    world_id = route.get("worldId") or route.get("courseId")
    if world_id is None or not manifest:
        return []

    paddocks_file = os.path.join(base_dir, "data/paddocks.json")
    intersections_file = os.path.join(base_dir, f"data/worlds/{world_id}/roadIntersections.json")
    if not os.path.exists(paddocks_file) or not os.path.exists(intersections_file):
        return []

    paddocks_data = _load_json(paddocks_file)
    world_paddocks = next((item for item in paddocks_data if item.get("worldId") == world_id), None)
    if not world_paddocks:
        return []

    event_paddocks = route.get("eventPaddocks")
    if not event_paddocks:
        return []

    paddock_keys = [int(value.strip()) for value in str(event_paddocks).split(",") if value.strip()]
    paddock_roads = [
        world_paddocks.get("paddockRoads", {}).get(str(key))
        for key in paddock_keys
    ]
    paddock_roads = [road_id for road_id in paddock_roads if road_id is not None]
    if not paddock_roads:
        return []

    intersections = _load_json(intersections_file)
    paddock_intersections = [
        next(item for item in intersections if item.get("id") == road_id)
        for road_id in paddock_roads
        if any(item.get("id") == road_id for item in intersections)
    ]
    if not paddock_intersections:
        return []

    roads_file = os.path.join(base_dir, f"data/worlds/{world_id}/roads.json")
    if not os.path.exists(roads_file):
        return []
    known_road_ids = {road["id"] for road in _load_json(roads_file)}

    first_manifest = manifest[0]
    target_forward = not bool(first_manifest.get("reverse"))
    start_road = next((item for item in paddock_intersections if not item.get("paddockExitRoadTime")), None)
    if start_road is None:
        start_road = paddock_intersections[0]

    pen_exit_route = _find_shortest_exit_path(
        start_road["id"],
        True,
        first_manifest["roadId"],
        target_forward,
        intersections,
        known_road_ids,
        route,
        world_id,
        base_dir,
    )
    if not pen_exit_route:
        return []

    leadin = _build_leadin_entries(pen_exit_route)
    if not leadin:
        return leadin

    route_with_leadin = copy.deepcopy(route)
    route_with_leadin["manifest"] = leadin + manifest
    _align_leadin_with_route_start(route_with_leadin)

    aligned_leadin = [entry for entry in route_with_leadin["manifest"] if entry.get("leadin")]
    return aligned_leadin
