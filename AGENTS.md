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