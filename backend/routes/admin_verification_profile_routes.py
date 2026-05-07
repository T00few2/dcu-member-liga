"""
Admin verification routes: rider profile and activity listing endpoints.
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import logging

from flask import jsonify, request

from authz import AuthzError, require_admin
from extensions import db, get_zwift_service, strava_service
from routes.admin import admin_bp
from services.dual_recording_core import (
    _compute_strava_power_curve,
    _extract_zwift_activity_fields,
    _iter_activities_for_user_ids,
)
from services.user_service import UserService
from services.zwift_tokens import get_token_doc, get_valid_access_token

logger = logging.getLogger(__name__)


@admin_bp.route("/admin/verification/rider/<rider_id>", methods=["GET"])
def verify_rider(rider_id):
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code

    if not db:
        return jsonify({"error": "DB not available"}), 500

    try:
        user = UserService.get_user_by_id(rider_id)
        if not user:
            return jsonify({"message": "User not found"}), 404

        zwift_id = user.zwift_id
        strava_auth = user.strava_auth
        response_data = {
            "profile": {},
            "stravaActivities": [],
            "zwiftPowerHistory": [],
            "officialMetrics": {},
        }

        def fetch_zwift_profile():
            if not zwift_id:
                return None
            access_token = get_valid_access_token(str(user.id), get_zwift_service())
            if not access_token:
                return None
            return get_zwift_service().get_profile(user_access_token=access_token)

        def fetch_strava():
            if not strava_auth or not zwift_id:
                return None
            return strava_service.get_activities(zwift_id)

        def fetch_power_curve():
            if not zwift_id:
                return None
            access_token = get_valid_access_token(str(user.id), get_zwift_service())
            if not access_token:
                return None
            service = get_zwift_service()

            with ThreadPoolExecutor(max_workers=6) as curve_executor:
                f_pp = curve_executor.submit(service.get_power_profile, access_token)
                f_all = curve_executor.submit(service.get_best_power_curve_all_time, access_token)
                f_30d = curve_executor.submit(service.get_best_power_curve_last, access_token, 30)
                f_90d = curve_executor.submit(service.get_best_power_curve_last, access_token, 90)
                f_180d = curve_executor.submit(service.get_best_power_curve_last, access_token, 180)
                f_360d = curve_executor.submit(service.get_best_power_curve_last, access_token, 360)

            curves = {}
            for key, fut in [
                ("allTime", f_all),
                ("last30d", f_30d),
                ("last90d", f_90d),
                ("last180d", f_180d),
                ("last360d", f_360d),
            ]:
                try:
                    curves[key] = fut.result()
                except Exception as exc:
                    logger.error("Error fetching %s curve: %s", key, exc)
                    curves[key] = None

            power_profile = None
            try:
                power_profile = f_pp.result()
            except Exception as exc:
                logger.error("Error fetching power profile: %s", exc)

            return {"powerProfile": power_profile, "curves": curves}

        with ThreadPoolExecutor(max_workers=3) as executor:
            f_profile = executor.submit(fetch_zwift_profile)
            f_strava = executor.submit(fetch_strava)
            f_power = executor.submit(fetch_power_curve)

        try:
            profile = f_profile.result(timeout=30)
            if profile:
                competition = profile.get("competitionMetrics") or {}
                response_data["profile"] = {
                    "weight": round(profile.get("weight", 0) / 1000, 1) if profile.get("weight") else None,
                    "height": (
                        round(profile.get("heightInMillimeters", 0) / 10, 0)
                        if profile.get("heightInMillimeters")
                        else None
                    ),
                    "maxHr": profile.get("heartRateMax", 0),
                    "img": profile.get("imageSrc"),
                    "racingScore": competition.get("racingScore"),
                    "zftp": competition.get("zftp"),
                    "zmap": competition.get("zmap"),
                }
        except Exception as exc:
            logger.error("Zwift Profile Fetch Error: %s", exc)

        try:
            strava_raw = f_strava.result(timeout=30)
            if strava_raw and "activities" in strava_raw:
                response_data["stravaActivities"] = strava_raw["activities"]
        except Exception as exc:
            logger.error("Strava Verification Fetch Error: %s", exc)

        try:
            power_data = f_power.result(timeout=60)
            if power_data:
                response_data["officialMetrics"] = power_data
                curves = power_data.get("curves") or {}
                now = datetime.utcnow()
                range_configs = [
                    ("last30d", now - timedelta(days=15), "Best Power (Last 30 Days)"),
                    ("last90d", now - timedelta(days=60), "Best Power (Last 90 Days)"),
                    ("last180d", now - timedelta(days=120), "Best Power (Last 180 Days)"),
                    ("last360d", now - timedelta(days=240), "Best Power (Last 360 Days)"),
                    ("allTime", now - timedelta(days=400), "Best Power (All Time)"),
                ]

                history = []
                rider_weight = response_data["profile"].get("weight") or 0
                rider_height = response_data["profile"].get("height") or 0

                for curve_key, entry_dt, title in range_configs:
                    curve_data = curves.get(curve_key)
                    if not curve_data:
                        continue
                    points = curve_data.get("pointsWatts") or {}
                    if not points:
                        continue

                    cp_curve = {f"w{duration_sec}": point.get("value", 0) for duration_sec, point in points.items()}
                    wkg_points = curve_data.get("pointsWattsPerKg") or {}
                    wkg_1200 = (wkg_points.get("1200") or {}).get("value", 0)
                    if not wkg_1200 and rider_weight:
                        wkg_1200 = round(cp_curve.get("w1200", 0) / rider_weight, 2)

                    history.append(
                        {
                            "date": entry_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
                            "event_title": title,
                            "avg_watts": cp_curve.get("w1200", 0),
                            "avg_hr": 0,
                            "wkg": wkg_1200,
                            "category": "",
                            "weight": rider_weight,
                            "height": rider_height,
                            "cp_curve": cp_curve,
                        }
                    )

                response_data["zwiftPowerHistory"] = history
        except Exception as exc:
            logger.error("Official metrics fetch error: %s", exc)

        return jsonify(response_data), 200
    except Exception as exc:
        return jsonify({"message": str(exc)}), 500


@admin_bp.route("/admin/verification/strava-power-curve/<rider_id>", methods=["GET"])
def strava_power_curve(rider_id):
    """Return rider's peak Strava power curve over last N days."""
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code

    days = request.args.get("days", 90, type=int)
    if days not in (30, 90, 180, 360):
        return jsonify({"message": "days must be one of 30, 90, 180, 360"}), 400

    try:
        user = UserService.get_user_by_id(rider_id)
        if not user:
            return jsonify({"message": "User not found"}), 404

        after_ts = int((datetime.now(timezone.utc) - timedelta(days=days)).timestamp())
        activities = strava_service.get_power_activities(str(user.id), after_ts)
        if not activities:
            return jsonify({"curve": {}, "activityCount": 0, "days": days}), 200

        curve = _compute_strava_power_curve(str(user.id), activities)
        return jsonify({"curve": curve, "activityCount": len(activities), "days": days}), 200
    except Exception as exc:
        logger.error("strava_power_curve error: %s", exc)
        return jsonify({"message": str(exc)}), 500


@admin_bp.route("/admin/verification/strava/streams/<activity_id>", methods=["GET"])
def get_strava_streams(activity_id):
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code

    zwift_id = request.args.get("zwiftId")
    if not zwift_id:
        return jsonify({"message": "Missing zwiftId"}), 400

    try:
        streams = strava_service.get_activity_streams(zwift_id, activity_id)
        if streams:
            return jsonify({"streams": streams}), 200
        return jsonify({"message": "Failed to fetch streams"}), 404
    except Exception as exc:
        return jsonify({"message": str(exc)}), 500


@admin_bp.route("/admin/verification/zwift-activities/<rider_id>", methods=["GET"])
def list_zwift_activities(rider_id):
    """Return recent Zwift activities stored via webhook for this rider."""
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code

    if not db:
        return jsonify({"error": "DB not available"}), 500

    try:
        user = UserService.get_user_by_id(rider_id)
        if not user:
            return jsonify({"message": "User not found"}), 404

        token_doc = get_token_doc(str(user.id))
        if not token_doc:
            return jsonify({"activities": [], "message": "No Zwift connection found"}), 200

        zwift_user_id = token_doc.get("zwiftUserId")
        if not zwift_user_id:
            return jsonify({"activities": [], "message": "No Zwift user ID on token"}), 200

        activities = []
        zwift_user_id_str = str(zwift_user_id).strip()
        for doc in _iter_activities_for_user_ids(db, [zwift_user_id_str], limit=100):
            d = doc.to_dict() or {}
            raw = d.get("data") or {}
            fields = _extract_zwift_activity_fields(raw)
            activities.append(
                {
                    "activityId": d.get("activityId"),
                    "startedAt": fields["startedAt"],
                    "name": fields["name"] or f"Activity {d.get('activityId')}",
                    "durationMs": fields["durationMs"],
                    "avgWatts": fields["avgWatts"],
                    "sport": fields["sport"],
                }
            )

        activities.sort(key=lambda a: a.get("startedAt") or "", reverse=True)
        activities = activities[:30]
        return jsonify({"activities": activities}), 200
    except Exception as exc:
        logger.error("list_zwift_activities error: %s", exc)
        return jsonify({"message": str(exc)}), 500


@admin_bp.route("/admin/verification/strava-activities/<rider_id>", methods=["GET"])
def list_strava_activities(rider_id):
    """Return recent Strava activities with full timestamps for matching."""
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code

    try:
        user = UserService.get_user_by_id(rider_id)
        if not user:
            return jsonify({"message": "User not found"}), 404

        activities = strava_service.get_activities_for_matching(str(user.id))
        return jsonify({"activities": activities}), 200
    except Exception as exc:
        logger.error("list_strava_activities error: %s", exc)
        return jsonify({"message": str(exc)}), 500
