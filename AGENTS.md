# Agent Execution Notes

## Backend Python Environment

- Always run backend Python scripts using Conda environment `py311`.
- Do not use system Python for backend scripts.

### Command pattern
- `conda run -n py311 python backend/scripts/<script>.py <args>`

### Examples
- `conda run -n py311 python backend/scripts/inspect_data.py --list-collections`
- `conda run -n py311 python backend/scripts/inspect_data.py --collection users --limit 20`
- `conda run -n py311 python backend/scripts/zwift_event_participants.py register --zwift-id <ID> --subgroup-id <SUBGROUP_ID>`
- `conda run -n py311 python backend/scripts/sync_sauce_data.py`

## Zwift Route / Segment Data

Static game data used for segment detection lives in `backend/data/` (`routes.json`, `worlds/*/roads.json`, `worlds/*/segments.json`, etc.).

When Zwift adds routes, refresh from an installed **Sauce for Zwift** app:

```text
conda run -n py311 python backend/scripts/sync_sauce_data.py
```

- Default source: `%LOCALAPPDATA%\Programs\sauce4zwift\resources\app.asar`
- Optional: `--sauce-data-dir PATH` if Sauce `shared/deps/data` is already extracted
- Copies routes/roads/worldlist/portal/countries; transforms Sauce segments into this repo’s dual forward/reverse schema
- Does **not** overwrite local-only files: `paddocks.json`, `segRequireStartEnd.json`, `worlds/*/roadIntersections.json`
- After sync, bump frontend `zwift-data` if elevation/Strava mapping for new routes is needed

Segment file paths are keyed by `worldId` (not Sauce `courseId`).

## Firestore Credentials

For Firestore access, initialize Firebase Admin in this order:
1. `GOOGLE_APPLICATION_CREDENTIALS` (preferred)
2. fallback local file: `backend/serviceAccountKey.json`
3. ADC only if explicitly configured

If a script fails due to missing auth, report that clearly and do not proceed with writes.

## Firestore Schema Maintenance

- If any Firestore collection/document shape is added, removed, or changed, update:
  - `firebase-firestore-structure.schema.json`
  - `firebase-firestore-structure.example.json`
- Keep example data sanitized (no real tokens, secrets, or personal data).
- Route profile metadata ownership:
  - `profileSegments` belongs in `elevation_cache` route docs.
  - Do not store `profileSegments` in `races` documents.

## Zwift API Reference

- Official Zwift API endpoint documentation for this repository is maintained in:
  - `zwift_api_docs.md`
- Use this file as the first reference when implementing or updating Zwift integration logic.