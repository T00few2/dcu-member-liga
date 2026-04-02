# Agent Execution Notes

## Backend Python Environment

- Always run backend Python scripts using Conda environment `py311`.
- Do not use system Python for backend scripts.

### Command pattern
- `conda run -n py311 python backend/scripts/<script>.py <args>`

### Examples
- `conda run -n py311 python backend/scripts/inspect_data.py --list-collections`
- `conda run -n py311 python backend/scripts/inspect_data.py --collection users --limit 20`

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