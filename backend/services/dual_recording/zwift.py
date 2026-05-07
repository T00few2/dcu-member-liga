from __future__ import annotations

from datetime import datetime

from extensions import get_zwift_service

from .time_series import _parse_iso_utc


def _parse_binary_fit_url(fit_url: str, access_token: str) -> tuple[dict | None, str]:
    """Download binary FIT file and extract per-second streams."""
    try:
        import fitdecode  # noqa: PLC0415
    except ImportError:
        return None, "fitdecode_not_installed"

    import io
    try:
        import requests as _req

        if "X-Amz-Signature" in fit_url or "amazonaws.com" in fit_url:
            headers = {"Accept": "*/*"}
        else:
            headers = {"Authorization": f"Bearer {access_token}", "Accept": "*/*"}
        resp = _req.get(fit_url, headers=headers, timeout=30)
        if resp.status_code != 200:
            return None, f"http_{resp.status_code}"
        raw = resp.content
    except Exception as exc:
        return None, f"download_error:{exc}"

    time_arr, watts_arr, hr_arr, cad_arr, alt_arr = [], [], [], [], []
    base_ts = None
    try:
        with fitdecode.FitReader(io.BytesIO(raw)) as fit:
            for frame in fit:
                if not isinstance(frame, fitdecode.FitDataMessage):
                    continue
                if frame.name != "record":
                    continue
                ts = frame.get_value("timestamp")
                if ts is None:
                    continue
                try:
                    epoch = ts.timestamp()
                except AttributeError:
                    epoch = float(ts)
                if base_ts is None:
                    base_ts = epoch
                time_arr.append(int(epoch - base_ts))
                watts_arr.append(frame.get_value("power"))
                hr_arr.append(frame.get_value("heart_rate"))
                cad_arr.append(frame.get_value("cadence"))
                alt_arr.append(frame.get_value("altitude"))
    except Exception as exc:
        return None, f"parse_error:{exc}"

    if not time_arr:
        return None, "no_records"

    return {
        "time": time_arr,
        "watts": watts_arr,
        "heartrate": hr_arr,
        "cadence": cad_arr,
        "altitude": alt_arr,
    }, f"ok_{len(time_arr)}_points"


def _parse_json_fit_streams(data: dict | list) -> dict:
    """Parse Zwift JSON FIT response into parallel stream arrays."""
    records = None
    if isinstance(data, list):
        records = data
    elif isinstance(data, dict):
        records = (
            data.get("records")
            or data.get("data")
            or data.get("record")
            or (data.get("messages") or {}).get("record")
        )
        if records is None and ("power" in data or "watts" in data):
            n = len(data.get("power") or data.get("watts") or [])
            return {
                "time": data.get("time") or list(range(n)),
                "watts": data.get("power") or data.get("watts") or [],
                "heartrate": data.get("heart_rate") or data.get("heartrate") or data.get("hr") or [],
                "cadence": data.get("cadence") or [],
                "altitude": data.get("altitude") or [],
            }

    if not records:
        return {"time": [], "watts": [], "heartrate": [], "cadence": [], "altitude": []}

    time_arr, watts_arr, hr_arr, cad_arr, alt_arr = [], [], [], [], []
    base_ts = None
    for rec in records:
        if not isinstance(rec, dict):
            continue
        ts = rec.get("timestamp")
        if ts is None:
            continue
        if isinstance(ts, str):
            dt = _parse_iso_utc(ts)
            epoch = dt.timestamp() if dt else None
        elif isinstance(ts, (int, float)):
            epoch = float(ts)
        else:
            continue
        if epoch is None:
            continue
        if base_ts is None:
            base_ts = epoch
        time_arr.append(int(epoch - base_ts))
        watts_arr.append(rec.get("power") or rec.get("watts"))
        hr_arr.append(rec.get("heart_rate") or rec.get("heartrate") or rec.get("hr"))
        cad_arr.append(rec.get("cadence"))
        alt_arr.append(rec.get("altitude"))

    return {
        "time": time_arr,
        "watts": watts_arr,
        "heartrate": hr_arr,
        "cadence": cad_arr,
        "altitude": alt_arr,
    }


def _extract_zwift_activity_fields(raw: dict) -> dict:
    """Extract normalized fields from a Zwift activity payload."""
    started_at = (
        raw.get("startDateTime")
        or raw.get("startedAt")
        or raw.get("startDate")
        or raw.get("start_date")
        or raw.get("started_at")
        or raw.get("startTime")
        or raw.get("activityStartDate")
    )
    if isinstance(started_at, (int, float)) and started_at > 1e10:
        try:
            from datetime import timezone as _tz

            started_at = datetime.fromtimestamp(started_at / 1000, tz=_tz.utc).isoformat()
        except Exception:
            started_at = None
    elif isinstance(started_at, (int, float)):
        try:
            from datetime import timezone as _tz

            started_at = datetime.fromtimestamp(started_at, tz=_tz.utc).isoformat()
        except Exception:
            started_at = None

    dur_ms = (
        raw.get("totalDurationInMilliSec")
        or raw.get("durationInMilliseconds")
        or raw.get("duration_in_milliseconds")
    )
    if not dur_ms:
        dur_sec_field = (
            raw.get("duration")
            or raw.get("durationInSeconds")
            or raw.get("totalDurationInSeconds")
            or raw.get("elapsed_time")
        )
        if dur_sec_field:
            dur_ms = dur_sec_field * 1000

    name = raw.get("activityName") or raw.get("name") or raw.get("activity_name") or ""
    avg_watts = (
        raw.get("avgWatts")
        or raw.get("averagePowerInWatts")
        or raw.get("average_watts")
        or raw.get("avg_watts")
    )

    return {
        "startedAt": started_at or None,
        "durationMs": dur_ms or 0,
        "durationSec": int(dur_ms / 1000) if dur_ms else None,
        "avgWatts": avg_watts,
        "name": name,
        "sport": raw.get("sport") or raw.get("type") or "CYCLING",
    }


def _fetch_zwift_streams(
    zwift_raw: dict, zwift_activity_id: str, access_token: str
) -> tuple[dict, dict]:
    """Fetch Zwift FIT streams for *zwift_activity_id*."""
    streams = None
    debug = {
        "fitFileURL": None,
        "jsonFitFileURL": None,
        "fitFetchStatus": None,
        "parsedPoints": 0,
        "activityKeys": list(zwift_raw.keys()),
    }

    json_fit_url = zwift_raw.get("jsonFitFileUrl") or zwift_raw.get("jsonFitFileURL")
    fresh = get_zwift_service().get_user_activity(str(zwift_activity_id), access_token) or {}
    fit_file_url = fresh.get("fitFileURL")
    if not json_fit_url:
        json_fit_url = fresh.get("jsonFitFileURL") or fresh.get("jsonFitFileUrl")
        debug["activityKeys"] = list(fresh.keys())

    debug["jsonFitFileURL"] = json_fit_url
    debug["fitFileURL"] = fit_file_url

    if json_fit_url:
        fit_resp = get_zwift_service().get_activity_json_fit(json_fit_url, access_token)
        debug["fitFetchStatus"] = "json_ok" if fit_resp is not None else "json_empty"
        if fit_resp:
            streams = _parse_json_fit_streams(fit_resp)
            debug["parsedPoints"] = len((streams or {}).get("time") or [])

    if debug["parsedPoints"] == 0 and fit_file_url:
        bin_streams, bin_status = _parse_binary_fit_url(fit_file_url, access_token)
        bin_n = len((bin_streams or {}).get("time") or [])
        debug["binaryFitStatus"] = bin_status
        debug["binaryFitPoints"] = bin_n
        if bin_n > 0:
            streams = bin_streams
            debug["parsedPoints"] = bin_n
    elif fit_file_url is None and json_fit_url is None:
        debug["fitFetchStatus"] = "no_url"

    return streams or {}, debug

