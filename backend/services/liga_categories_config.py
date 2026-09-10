"""Dry-run / apply liga category configuration with rider and race remaps."""
from __future__ import annotations

import re
from typing import Any

from firebase_admin import firestore

from services.category_apply import (
    SAMPLE_LIMIT,
    accumulate_user_stats,
    empty_user_counts,
    race_name_string_diff,
    remap_race_groups,
    remap_simple_name_list,
    remap_user_liga_category,
    rider_sample,
)
from services.category_changelog import (
    CategoryChangelogError,
    liga_categories_fingerprint,
    resolve_name_through_ops,
    validate_changelog,
)
from services.category_engine import effective_rating
from services.schema_validation import (
    log_schema_issues,
    validate_league_settings_doc,
    validate_race_doc,
    validate_user_doc,
    with_schema_version,
)

_FIRESTORE_BATCH_SIZE = 400


class ConfigApplyError(ValueError):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


_HEX_COLOR_RE = re.compile(r"^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$")


def _parse_category_color(raw: object) -> str | None:
    if not isinstance(raw, str):
        return None
    value = raw.strip()
    match = _HEX_COLOR_RE.fullmatch(value)
    if not match:
        return None
    digits = match.group(1)
    if len(digits) == 3:
        digits = "".join(ch * 2 for ch in digits)
    return f"#{digits.lower()}"


def _normalise_submitted(categories: list[dict]) -> list[dict]:
    out: list[dict] = []
    for c in categories:
        item: dict = {
            "name": str(c.get("name") or "").strip(),
            "upper": int(c["upper"]) if c.get("upper") is not None else None,
            "requiresVerification": bool(c.get("requiresVerification")),
        }
        color = _parse_category_color(c.get("color"))
        if color:
            item["color"] = color
        out.append(item)
    return out


def validate_submitted_shape(categories: list) -> list[dict]:
    if not categories or not isinstance(categories, list):
        raise ConfigApplyError("'categories' must be a non-empty list")
    if len(categories) < 2:
        raise ConfigApplyError("At least 2 categories are required")
    for cat in categories:
        if not isinstance(cat, dict):
            raise ConfigApplyError("Each category must be an object")
        name = cat.get("name", "")
        if not isinstance(name, str) or not name.strip():
            raise ConfigApplyError("Each category must have a non-empty name")
        upper = cat.get("upper")
        if upper is not None and not isinstance(upper, (int, float)):
            raise ConfigApplyError("upper must be a number or null")

    null_upper_count = sum(1 for c in categories if c.get("upper") is None)
    if null_upper_count != 1:
        raise ConfigApplyError("Exactly one category must have upper=null (the top)")
    if categories[0].get("upper") is not None:
        raise ConfigApplyError("The category with upper=null must be first")

    uppers = [c["upper"] for c in categories[1:]]
    for i in range(len(uppers) - 1):
        if uppers[i] is not None and uppers[i + 1] is not None and uppers[i] <= uppers[i + 1]:
            raise ConfigApplyError("Upper boundaries must be strictly decreasing")
    return _normalise_submitted(categories)


def _commit_sets(db_client, writes: list[tuple[Any, dict]], merge: bool = True) -> None:
    batch = db_client.batch()
    count = 0
    for ref, payload in writes:
        batch.set(ref, payload, merge=merge)
        count += 1
        if count >= _FIRESTORE_BATCH_SIZE:
            batch.commit()
            batch = db_client.batch()
            count = 0
    if count:
        batch.commit()


def _commit_updates(db_client, writes: list[tuple[Any, dict]]) -> None:
    batch = db_client.batch()
    count = 0
    for ref, payload in writes:
        batch.update(ref, payload)
        count += 1
        if count >= _FIRESTORE_BATCH_SIZE:
            batch.commit()
            batch = db_client.batch()
            count = 0
    if count:
        batch.commit()


def run_liga_categories_config(
    db_client,
    logger,
    *,
    submitted_raw: list,
    ops: list | None,
    dry_run: bool,
    expected_fingerprint: str | None,
    grace_period: int | None = None,
) -> dict[str, Any]:
    submitted = validate_submitted_shape(submitted_raw)
    settings_doc = db_client.collection("league").document("settings").get()
    settings = settings_doc.to_dict() if settings_doc.exists else {}
    old_defs = settings.get("ligaCategories") or []
    current_fp = liga_categories_fingerprint(old_defs)

    if expected_fingerprint and expected_fingerprint != current_fp:
        raise ConfigApplyError(
            "Category configuration changed since preview. Reload and preview again.",
            409,
        )
    if not dry_run:
        if not expected_fingerprint:
            raise ConfigApplyError("expectedFingerprint is required to apply")
        if expected_fingerprint != current_fp:
            raise ConfigApplyError(
                "Category configuration changed since preview. Reload and preview again.",
                409,
            )

    try:
        parsed = validate_changelog(old_defs, ops or [], submitted)
    except CategoryChangelogError as exc:
        raise ConfigApplyError(str(exc)) from exc

    grace = int(grace_period if grace_period is not None else settings.get("gracePeriod", 35))
    ops_list = list(ops or [])
    next_fp = liga_categories_fingerprint(submitted)

    user_counts = empty_user_counts()
    user_samples: list[dict] = []
    user_writes: list[tuple[Any, dict]] = []

    docs = db_client.collection("users").where("registration.status", "==", "complete").stream()
    for doc in docs:
        data = doc.to_dict() or {}
        lc = data.get("ligaCategory")
        zr = data.get("zwiftRacing") or {}
        eff = effective_rating(
            zr.get("currentRating", "N/A"),
            zr.get("max30Rating", "N/A"),
            zr.get("max90Rating", "N/A"),
        )
        next_lc, stats = remap_user_liga_category(
            lc,
            ops=ops_list,
            new_defs=submitted,
            grace_period=grace,
            eff_rating=eff,
        )
        changed = next_lc is not None
        accumulate_user_stats(user_counts, stats, changed)
        if not changed:
            continue
        if len(user_samples) < SAMPLE_LIMIT:
            user_samples.append(
                rider_sample(str(data.get("name") or ""), str(data.get("zwiftId") or doc.id), stats)
            )
        update = with_schema_version({"ligaCategory": next_lc})
        log_schema_issues(logger, f"users/{doc.id} (liga category remap)", validate_user_doc(update, partial=True))
        user_writes.append((doc.reference, update))

    race_changes: list[dict] = []
    race_writes: list[tuple[Any, dict]] = []
    default_groups = settings.get("defaultRaceGroups")
    next_default_groups = remap_race_groups(default_groups, ops_list)
    default_diff = race_name_string_diff(
        label="defaultRaceGroups",
        before_groups=default_groups,
        after_groups=next_default_groups,
    )
    race_changes.extend(default_diff)

    next_default_single = remap_simple_name_list(
        settings.get("defaultSingleCategories"), ops_list, "category"
    )
    if next_default_single != (settings.get("defaultSingleCategories") or []):
        race_changes.append(
            {
                "where": "defaultSingleCategories",
                "from": [r.get("category") for r in (settings.get("defaultSingleCategories") or []) if isinstance(r, dict)],
                "to": [r.get("category") for r in next_default_single],
            }
        )

    next_default_multi = remap_simple_name_list(
        settings.get("defaultEventConfiguration"), ops_list, "customCategory"
    )
    if next_default_multi != (settings.get("defaultEventConfiguration") or []):
        race_changes.append(
            {
                "where": "defaultEventConfiguration",
                "from": [
                    r.get("customCategory")
                    for r in (settings.get("defaultEventConfiguration") or [])
                    if isinstance(r, dict)
                ],
                "to": [r.get("customCategory") for r in next_default_multi],
            }
        )

    settings_extra: dict[str, Any] = {}
    if default_diff:
        settings_extra["defaultRaceGroups"] = next_default_groups
    if next_default_single != (settings.get("defaultSingleCategories") or []):
        settings_extra["defaultSingleCategories"] = next_default_single
    if next_default_multi != (settings.get("defaultEventConfiguration") or []):
        settings_extra["defaultEventConfiguration"] = next_default_multi

    for race_doc in db_client.collection("races").stream():
        race = race_doc.to_dict() or {}
        payload: dict[str, Any] = {}
        groups = race.get("raceGroups")
        next_groups = remap_race_groups(groups, ops_list)
        gdiff = race_name_string_diff(
            label=f"races/{race_doc.id}.raceGroups",
            before_groups=groups,
            after_groups=next_groups,
        )
        if gdiff:
            payload["raceGroups"] = next_groups
            race_changes.extend(gdiff)

        single = race.get("singleModeCategories")
        next_single = remap_simple_name_list(single, ops_list, "category")
        if next_single != (single or []):
            payload["singleModeCategories"] = next_single
            race_changes.append(
                {
                    "where": f"races/{race_doc.id}.singleModeCategories",
                    "from": [r.get("category") for r in (single or []) if isinstance(r, dict)],
                    "to": [r.get("category") for r in next_single],
                }
            )

        multi = race.get("eventConfiguration")
        next_multi = remap_simple_name_list(multi, ops_list, "customCategory")
        if next_multi != (multi or []):
            payload["eventConfiguration"] = next_multi
            race_changes.append(
                {
                    "where": f"races/{race_doc.id}.eventConfiguration",
                    "from": [r.get("customCategory") for r in (multi or []) if isinstance(r, dict)],
                    "to": [r.get("customCategory") for r in next_multi],
                }
            )

        if payload:
            update = with_schema_version(payload)
            log_schema_issues(
                logger,
                f"races/{race_doc.id} (category name remap)",
                validate_race_doc(update, partial=True),
            )
            race_writes.append((race_doc.reference, update))

    signup_changes = 0
    signup_samples: list[dict] = []
    signup_writes: list[tuple[Any, dict]] = []
    user_rating_by_zwift: dict[str, int | None] = {}

    for race_doc in db_client.collection("races").stream():
        for sdoc in race_doc.reference.collection("signups").stream():
            sdata = sdoc.to_dict() or {}
            old_name = str(sdata.get("ligaCategory") or "").strip()
            if not old_name:
                continue
            zwift_id = str(sdata.get("zwiftId") or sdoc.id)
            if zwift_id not in user_rating_by_zwift:
                udoc = db_client.collection("users").document(zwift_id).get()
                udata = udoc.to_dict() if udoc.exists else {}
                zr = (udata or {}).get("zwiftRacing") or {}
                user_rating_by_zwift[zwift_id] = effective_rating(
                    zr.get("currentRating", "N/A"),
                    zr.get("max30Rating", "N/A"),
                    zr.get("max90Rating", "N/A"),
                )
            new_name = resolve_name_through_ops(old_name, user_rating_by_zwift[zwift_id], ops_list)
            if new_name == old_name:
                continue
            signup_changes += 1
            if len(signup_samples) < SAMPLE_LIMIT:
                signup_samples.append(
                    {
                        "raceId": race_doc.id,
                        "zwiftId": zwift_id,
                        "from": old_name,
                        "to": new_name,
                    }
                )
            signup_writes.append((sdoc.reference, {"ligaCategory": new_name}))

    preview = {
        "dryRun": dry_run,
        "remap": parsed["remap"],
        "splits": parsed["splits"],
        "currentFingerprint": current_fp,
        "nextFingerprint": next_fp,
        "counts": {
            **user_counts,
            "raceDocsUpdated": len(race_writes),
            "signupRewrite": signup_changes,
        },
        "samples": {
            "riders": user_samples,
            "races": race_changes[:40],
            "signups": signup_samples,
        },
    }

    if dry_run:
        preview["message"] = "Dry run — no writes"
        return preview

    _commit_updates(db_client, user_writes)
    _commit_sets(db_client, race_writes, merge=True)
    _commit_updates(db_client, signup_writes)

    settings_update = with_schema_version(
        {
            "ligaCategories": submitted,
            "updatedAt": firestore.SERVER_TIMESTAMP,
            **settings_extra,
        }
    )
    if grace_period is not None:
        settings_update["gracePeriod"] = grace
    log_schema_issues(
        logger,
        "league/settings (liga categories config)",
        validate_league_settings_doc(settings_update, partial=True),
    )
    db_client.collection("league").document("settings").set(settings_update, merge=True)

    preview["message"] = "Category configuration saved"
    preview["count"] = len(submitted)
    preview["applied"] = True
    return preview
