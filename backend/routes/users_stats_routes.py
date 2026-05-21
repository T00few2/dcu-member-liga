from __future__ import annotations

import logging

from flask import jsonify, request

from authz import AuthzError, verify_user_token
from extensions import db, get_zwift_service, zr_service
from services.category_engine import serialize_liga_category
from services.user_service import UserService
from services.zwift_tokens import get_valid_access_token
from routes.users import users_bp

logger = logging.getLogger(__name__)


@users_bp.route("/participants", methods=["GET"])
def get_participants():
    try:
        verify_user_token(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code

    if not db:
        return jsonify({"error": "DB not available"}), 500

    try:
        participants = []
        malformed = 0
        raw_limit = request.args.get("limit", "1000")
        try:
            fetch_limit = min(int(raw_limit), 2000)
        except (ValueError, TypeError):
            fetch_limit = 1000
        user_objects = UserService.get_all_participants(limit=fetch_limit)

        for user in user_objects:
            try:
                data = user._data
                zr = data.get("zwiftRacing", {})
                zpro = data.get("zwiftProfile", {})
                lc = serialize_liga_category(data.get("ligaCategory"))

                zpc = data.get("zwiftPowerCurve", {})
                relevant_efforts = {
                    e["duration"]: e
                    for e in (zpc.get("relevantCpEfforts") or [])
                    if isinstance(e, dict) and "duration" in e
                }

                def cp(duration_sec: int) -> int | None:
                    effort = relevant_efforts.get(duration_sec)
                    if effort:
                        w = effort.get("watts")
                        return round(w) if w else None
                    return None

                participants.append(
                    {
                        "name": user.name,
                        "zwiftId": user.zwift_id,
                        "club": user.club,
                        "category": (lc.get("category") if lc else None) or "N/A",
                        "zftp": zpro.get("zftp", "N/A"),
                        "zmap": zpro.get("zmap", "N/A"),
                        "zwiftCategory": zpro.get("category", "N/A"),
                        "weightInGrams": zpro.get("weight") or zpro.get("weightInGrams"),
                        "cp5s": cp(5),
                        "cp15s": cp(15),
                        "cp1min": cp(60),
                        "cp5min": cp(300),
                        "cp20min": cp(1200),
                        "rating": zr.get("currentRating", "N/A"),
                        "max30Rating": zr.get("max30Rating", "N/A"),
                        "max90Rating": zr.get("max90Rating", "N/A"),
                        "phenotype": zr.get("phenotype", "N/A"),
                        "racingScore": zpro.get("racingScore", "N/A"),
                        "weightVerificationStatus": user.verification_status,
                        "ligaCategory": lc,
                    }
                )
            except Exception as rider_error:
                malformed += 1
                logger.warning("Skipping malformed participant user_id=%s: %s", user.id, rider_error)

        if malformed:
            logger.warning("Participants endpoint skipped malformed users: %s", malformed)

        return jsonify({"participants": participants}), 200
    except Exception as e:
        logger.error("Participants List Error: %s", e)
        return jsonify({"message": str(e)}), 500


@users_bp.route("/public/member-count", methods=["GET"])
def get_public_member_count():
    if not db:
        return jsonify({"error": "DB not available"}), 500
    try:
        docs = db.collection("users").where("registration.status", "==", "complete").stream()
        count = sum(1 for _ in docs)
        return jsonify({"memberCount": count}), 200
    except Exception as e:
        logger.error("Member count error: %s", e)
        return jsonify({"message": str(e)}), 500


@users_bp.route("/stats", methods=["GET"])
def get_stats():
    target_user = None
    try:
        decoded_token = verify_user_token(request)
        uid = decoded_token["uid"]
        target_user = UserService.get_user_by_auth_uid(uid)
    except AuthzError:
        pass
    except Exception as e:
        logger.error("Token lookup failed in stats: %s", e)

    zr_data = {}
    zwift_data = {}

    if target_user and db:
        try:
            zwift_id = target_user.zwift_id
            if zwift_id:
                try:
                    zr_json = zr_service.get_rider_data(str(zwift_id))
                    if zr_json:
                        data = zr_json if "race" in zr_json else (zr_json.get("data") or {})
                        race = data.get("race") or {}
                        zr_data = {
                            "currentRating": (race.get("current") or {}).get("rating", "N/A"),
                            "max30Rating": (race.get("max30") or {}).get("rating", "N/A"),
                            "max90Rating": (race.get("max90") or {}).get("rating", "N/A"),
                            "phenotype": (data.get("phenotype") or {}).get("value", "N/A"),
                            "finishes": race.get("finishes", 0),
                            "wins": race.get("wins", 0),
                            "podiums": race.get("podiums", 0),
                            "dnfs": race.get("dnfs", 0),
                        }
                except Exception as zr_e:
                    logger.error("ZwiftRacing fetch error: %s", zr_e)

                try:
                    zwift_service = get_zwift_service()
                    access_token = get_valid_access_token(str(target_user.id), zwift_service)
                    profile = zwift_service.get_profile(user_access_token=access_token) if access_token else None
                    if profile:
                        competition = profile.get("competitionMetrics") or {}
                        weight_raw = profile.get("weight")
                        if weight_raw is None:
                            weight_raw = competition.get("weightInGrams")
                        try:
                            weight_kg = float(weight_raw) / 1000 if weight_raw is not None else None
                        except (TypeError, ValueError):
                            weight_kg = None
                        zwift_data = {
                            "ftp": competition.get("ftp", "N/A"),
                            "weight": f"{weight_kg} kg"
                            if weight_kg is not None
                            else "N/A",
                            "height": f"{round(profile.get('heightInMillimeters', 0) / 10, 0)} cm"
                            if profile.get("heightInMillimeters")
                            else "N/A",
                            "racingScore": competition.get("racingScore", "N/A"),
                            "zftp": competition.get("zftp", "N/A"),
                            "zmap": competition.get("zmap", "N/A"),
                            "vo2max": competition.get("vo2max", "N/A"),
                        }
                except Exception as z_e:
                    logger.error("Zwift API fetch error: %s", z_e)

        except Exception as e:
            logger.error("Error fetching stats: %s", e)

    stats_data = {
        "stats": [
            {"platform": "Zwift", **zwift_data},
            {"platform": "ZwiftRacing", **zr_data},
        ]
    }
    return jsonify(stats_data), 200

