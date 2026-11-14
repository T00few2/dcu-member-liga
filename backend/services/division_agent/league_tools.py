"""League knowledge for the Discord help bot: read-only tools over live data.

Nothing here is a second copy of the league's text. Rules, format, categories, points,
verification and page links come from the site's generated `/llms.txt` (built from the
league settings, stage races and news). Everything else is read live from Firestore:
the race schedule, standings, results, published news posts, the data policy and, for a
linked rider only, their own registration status.

Questions the tools cannot answer are logged with `report_unanswered` so the admins can
fix the gap at its source.
"""
from __future__ import annotations

import logging
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Callable

import pytz
import requests

from config import FRONTEND_URL

logger = logging.getLogger(__name__)

UNANSWERED = "bot_unanswered_questions"
GUIDE_TTL_SECONDS = 600
GUIDE_MAX_CHARS = 60000  # rules + Code of Conduct come first; news is last and is cut first
NEWS_MAX_CHARS = 3000
TOP_N = 10
_CPH = pytz.timezone("Europe/Copenhagen")
_BLOCK_TYPES = {"paragraph", "heading", "listItem", "blockquote", "codeBlock"}

_guide_cache: dict[str, Any] = {"text": None, "at": 0.0}


def site_url() -> str:
    return (FRONTEND_URL or "").rstrip("/")


# --- league guide (/llms.txt) ---------------------------------------------------------

def league_guide(*, http: Any = requests, clock: Callable[[], float] = time.monotonic) -> dict:
    """The site's generated league guide. Cached; on failure the last good copy is reused."""
    now = clock()
    cached = _guide_cache.get("text")
    if cached and now - float(_guide_cache.get("at") or 0) < GUIDE_TTL_SECONDS:
        return {"guide": cached, "source": f"{site_url()}/llms.txt"}
    try:
        res = http.get(f"{site_url()}/llms.txt", timeout=10)
        if res.status_code != 200 or not (res.text or "").strip():
            raise ValueError(f"status {res.status_code}")
        text = res.text[:GUIDE_MAX_CHARS]
        _guide_cache.update(text=text, at=now)
        return {"guide": text, "source": f"{site_url()}/llms.txt"}
    except Exception as exc:
        logger.warning("league guide: could not fetch llms.txt: %s", exc)
        if cached:
            return {"guide": cached, "source": f"{site_url()}/llms.txt", "stale": True}
        return {"error": "The league guide is not available right now.",
                "pages": [f"{site_url()}/info", f"{site_url()}/point", f"{site_url()}/schedule"]}


# --- race schedule and results ----------------------------------------------------------

def _parse_date(value: Any) -> datetime | None:
    from services.race_signups import parse_race_date  # imported lazily: it pulls in the app's db
    return parse_race_date(value)


def _local(dt: datetime | None) -> str | None:
    return dt.astimezone(_CPH).strftime("%Y-%m-%d %H:%M") if dt else None


def _races(db: Any) -> list[tuple[str, dict, datetime | None]]:
    out = []
    for snap in db.collection("races").stream():
        data = snap.to_dict() or {}
        out.append((str(snap.id), data, _parse_date(data.get("date"))))
    return out


def _stage_names(db: Any, ids: set[str]) -> dict[str, str]:
    names = {}
    for sid in ids:
        try:
            snap = db.collection("stageRaces").document(sid).get()
            if getattr(snap, "exists", False):
                names[sid] = str((snap.to_dict() or {}).get("name") or "")
        except Exception:
            continue
    return names


def _race_card(race_id: str, data: dict, when: datetime | None, stage_names: dict[str, str]) -> dict:
    starts = []
    for cfg in data.get("eventConfiguration") or []:
        if isinstance(cfg, dict) and (cfg.get("customCategory") or cfg.get("startTime")):
            starts.append({"category": cfg.get("customCategory"), "startTime": cfg.get("startTime"),
                           "laps": cfg.get("laps")})
    card = {
        "name": data.get("name"),
        "start": _local(when),
        "world": data.get("map"),
        "route": data.get("routeName"),
        "laps": data.get("laps"),
        "distanceKm": data.get("totalDistance"),
        "elevationM": data.get("totalElevation"),
        "type": data.get("type"),
        "startTimesByCategory": starts or None,
        "link": f"{site_url()}/schedule",
    }
    sid = str(data.get("stageRaceId") or "")
    if sid:
        card["stageRace"] = stage_names.get(sid) or sid
        if data.get("stageIndex") is not None:
            card["stage"] = int(data["stageIndex"])  # already 1-based (the site shows "Etape {stageIndex}")
    return {k: v for k, v in card.items() if v not in (None, "", [])}


def race_schedule(db: Any, *, past: bool = False, now: datetime | None = None) -> dict:
    t = now or datetime.now(timezone.utc)
    rows = [r for r in _races(db) if r[2] is not None]
    if past:
        chosen = sorted([r for r in rows if r[2] < t], key=lambda r: r[2], reverse=True)[:5]
    else:
        chosen = sorted([r for r in rows if r[2] >= t], key=lambda r: r[2])[:TOP_N]
    names = _stage_names(db, {str(d.get("stageRaceId")) for _, d, _ in chosen if d.get("stageRaceId")})
    return {"timezone": "Europe/Copenhagen", "now": _local(t),
            "races": [_race_card(rid, d, w, names) for rid, d, w in chosen],
            "link": f"{site_url()}/schedule"}


def standings(db: Any, *, division: str | None = None) -> dict:
    snap = db.collection("league").document("standings").get()
    data = (snap.to_dict() or {}) if getattr(snap, "exists", False) else {}
    table = data.get("standings") or {}
    out = {}
    for cat, entries in table.items():
        if division and str(cat).lower() != str(division).lower():
            continue
        ordered = sorted([e for e in entries or [] if isinstance(e, dict)],
                         key=lambda e: -(e.get("totalPoints") or 0))[:TOP_N]
        out[cat] = [{"rank": i + 1, "name": e.get("name"), "points": e.get("totalPoints"),
                     "races": e.get("raceCount")} for i, e in enumerate(ordered)]
    if division and not out:
        return {"error": f"No standings for division {division}", "divisions": sorted(table.keys())}
    return {"standings": out, "link": f"{site_url()}/results"}


def race_results(db: Any, *, race: str | None = None, now: datetime | None = None) -> dict:
    t = now or datetime.now(timezone.utc)
    finished = [r for r in _races(db) if r[1].get("results") and (r[2] is None or r[2] < t)]
    if race:
        wanted = race.lower()
        finished = [r for r in finished if wanted in str(r[1].get("name") or "").lower()]
    if not finished:
        return {"error": "No finished race with results matches." if race else "No results yet."}
    race_id, data, when = max(finished, key=lambda r: r[2] or datetime.min.replace(tzinfo=timezone.utc))
    results = {}
    for cat, rows in (data.get("results") or {}).items():
        ordered = sorted([r for r in rows or [] if isinstance(r, dict)],
                         key=lambda r: -(r.get("totalPoints") or 0))[:TOP_N]
        results[cat] = [{"rank": i + 1, "name": r.get("name"), "club": r.get("club"),
                         "points": r.get("totalPoints"), "status": r.get("raceStatus")}
                        for i, r in enumerate(ordered)]
    return {"race": data.get("name"), "date": _local(when), "results": results, "link": f"{site_url()}/results"}


# --- news --------------------------------------------------------------------------------

def post_plain_text(node: Any) -> str:
    """Port of `postPlainText` (frontend/lib/postHtml.ts): TipTap JSON → one line of text."""
    out: list[str] = []

    def walk(n: Any) -> None:
        if not isinstance(n, dict):
            return
        if n.get("type") == "text":
            out.append(str(n.get("text") or ""))
            return
        if n.get("type") == "hardBreak":
            out.append(" ")
            return
        for child in n.get("content") or []:
            walk(child)
        if n.get("type") in _BLOCK_TYPES:
            out.append(" ")

    walk(node)
    return re.sub(r"\s+", " ", "".join(out)).strip()


def _published_at(data: dict) -> datetime | None:
    value = data.get("publishedAt")
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


def read_news(db: Any, *, query: str | None = None, limit: int = 3) -> dict:
    posts = []
    for snap in db.collection("posts").where("status", "==", "published").stream():
        data = snap.to_dict() or {}
        posts.append((data, _published_at(data)))
    posts.sort(key=lambda p: p[1] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    if query:
        words = [w for w in re.findall(r"\w+", query.lower()) if len(w) > 2]
        if words:
            def score(p):
                hay = (str(p[0].get("title") or "") + " " + post_plain_text(p[0].get("body"))).lower()
                return sum(hay.count(w) for w in words)
            scored = [(score(p), p) for p in posts]
            posts = [p for s, p in sorted(scored, key=lambda x: -x[0]) if s > 0]
    items = []
    for data, when in posts[:max(1, min(limit, 5))]:
        text = post_plain_text(data.get("body"))
        items.append({"title": data.get("title"), "published": _local(when),
                      "link": f"{site_url()}/nyheder/{data.get('slug') or ''}",
                      "text": text[:NEWS_MAX_CHARS] + ("…" if len(text) > NEWS_MAX_CHARS else "")})
    if not items:
        return {"error": "No published news matches.", "link": f"{site_url()}/nyheder"}
    return {"posts": items, "link": f"{site_url()}/nyheder"}


# --- data policy -----------------------------------------------------------------------

def data_policy(db: Any) -> dict:
    from services.policy_store import PolicyError, get_current_policy
    try:
        p = get_current_policy(db, "dataPolicy")
    except PolicyError as exc:
        return {"error": exc.message if hasattr(exc, "message") else str(exc)}
    content = str(p.get("contentMdDa") or "")
    return {"title": p.get("titleDa"), "version": p.get("version"), "text": content[:8000],
            "link": f"{site_url()}/datapolitik"}


# --- the asking rider's own status (linked riders only) ---------------------------------

def my_status(db: Any, zwift_id: str, user: dict, *, now: datetime | None = None) -> dict:
    t = now or datetime.now(timezone.utc)
    reg = user.get("registration") or {}
    ver = user.get("verification") or {}
    req = ver.get("currentRequest") or {}
    conns = user.get("connections") or {}
    lc = user.get("ligaCategory") or {}
    signups = []
    try:
        races = {rid: (d, w) for rid, d, w in _races(db)}
        for snap in db.collection_group("signups").where("zwiftId", "==", str(zwift_id)).stream():
            s = snap.to_dict() or {}
            rid = str(s.get("raceId") or "")
            d, w = races.get(rid, ({}, None))
            if w is not None and w < t:
                continue
            signups.append({"race": d.get("name") or rid, "start": _local(w), "status": s.get("status"),
                            "category": s.get("ligaCategory")})
    except Exception as exc:
        logger.warning("my_status: could not read sign-ups: %s", exc)
    signups.sort(key=lambda s: s.get("start") or "")
    position = None
    try:
        snap = db.collection("league").document("standings").get()
        table = ((snap.to_dict() or {}) if getattr(snap, "exists", False) else {}).get("standings") or {}
        for cat, entries in table.items():
            ordered = sorted([e for e in entries or [] if isinstance(e, dict)],
                             key=lambda e: -(e.get("totalPoints") or 0))
            for i, e in enumerate(ordered):
                if str(e.get("zwiftId")) == str(zwift_id):
                    position = {"division": cat, "rank": i + 1, "of": len(ordered),
                                "points": e.get("totalPoints"), "races": e.get("raceCount")}
    except Exception as exc:
        logger.warning("my_status: could not read standings: %s", exc)
    from services.category_engine import effective_liga_category_name
    from services.dual_recording.submitted import normalize_method

    method = normalize_method(user.get("dualRecordingMethod"))
    return {
        "registered": reg.get("status") == "complete",
        "registrationStatus": reg.get("status"),
        "division": effective_liga_category_name(lc) or None,
        "connections": {
            "zwift": bool((conns.get("zwift") or {}).get("connected")),
            "strava": bool((conns.get("strava") or {}).get("athlete_id")),
            "discord": bool((conns.get("discord") or {}).get("userId")),
        },
        "verification": {
            "status": ver.get("status"),
            "openRequest": {k: req.get(k) for k in ("type", "status", "deadline", "raceName")}
            if req and req.get("status") not in (None, "approved", "rejected") else None,
        },
        "dualRecording": {
            "optIn": user.get("dualRecordingOptIn") is True,
            "method": method,
            "methodLabel": {
                "strava": "Strava",
                "direct": "browser recording (experimental)",
                "upload": "FIT upload (experimental)",
            }.get(method, "Strava"),
            "where": {
                "strava": "Connect Strava on the profile. Pair the dual-recording power meter with a head unit "
                          "(Wahoo, Garmin, or the Strava app) and upload that activity to Strava after the race. "
                          "The league then matches it.",
                "direct": "From 48 hours before the heat, open Optag dual on the race card "
                          "(Chrome on Android or a computer). FIT upload remains available under Verifikation.",
                "upload": "Upload the FIT file under Verifikation on the row for that race.",
            }.get(method),
        },
        "trainer": ((user.get("equipment") or {}).get("trainer") or None),
        "upcomingSignups": signups[:TOP_N],
        "standing": position,
        "links": {"profile": f"{site_url()}/register", "verification": f"{site_url()}/verification"},
    }


# --- unanswered questions --------------------------------------------------------------

def report_unanswered(db: Any, *, question: str, missing: str, thread_id: str, discord_user_id: str,
                      zwift_id: str | None, guild_id: str | None = None, now: datetime | None = None) -> dict:
    """Log a question the bot could not answer (once per thread and question)."""
    t = now or datetime.now(timezone.utc)
    q = (question or "").strip()[:1000]
    if not q:
        return {"status": "nothing to report"}
    key = re.sub(r"\W+", " ", q.lower()).strip()[:200]
    for snap in db.collection(UNANSWERED).where("threadId", "==", str(thread_id)).stream():
        if (snap.to_dict() or {}).get("key") == key:
            return {"status": "already passed to the admins"}
    doc_id = uuid.uuid4().hex
    db.collection(UNANSWERED).document(doc_id).set({
        "id": doc_id,
        "question": q,
        "key": key,
        "missing": (missing or "").strip()[:1000],
        "threadId": str(thread_id),
        "guildId": str(guild_id) if guild_id else None,
        "discordUserId": str(discord_user_id),
        "zwiftId": zwift_id,
        "status": "open",
        "createdAt": t.isoformat(),
    })
    return {"status": "passed to the admins"}


def list_unanswered(db: Any, *, status: str = "open", limit: int = 100) -> list[dict]:
    rows = []
    for snap in db.collection(UNANSWERED).where("status", "==", status).stream():
        data = snap.to_dict() or {}
        rows.append({**data, "id": data.get("id") or snap.id})
    rows.sort(key=lambda r: str(r.get("createdAt") or ""), reverse=True)
    return rows[:limit]


def resolve_unanswered(db: Any, item_id: str, *, resolved_by: str, note: str | None = None,
                       now: datetime | None = None) -> dict:
    ref = db.collection(UNANSWERED).document(str(item_id))
    snap = ref.get()
    if not getattr(snap, "exists", False):
        raise LookupError("not found")
    data = snap.to_dict() or {}
    if data.get("status") == "resolved":
        return {**data, "id": str(item_id)}
    update = {"status": "resolved", "resolvedBy": resolved_by,
              "resolvedAt": (now or datetime.now(timezone.utc)).isoformat(),
              "note": (note or "").strip()[:1000] or None}
    ref.set(update, merge=True)
    return {**data, **update, "id": str(item_id)}
