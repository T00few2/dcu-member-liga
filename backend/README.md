# DCU Member Liga - Backend

This backend is built using **Python Flask** and is designed to run as a Google Cloud Function (`functions-framework`). It handles race management, results processing, league standings calculations, and user profiles.

## Project Structure

The project uses a modular architecture using Flask Blueprints and dedicated service classes.

### 1. Entry Point
*   **`main.py`**: The entry point for the Cloud Function.
    *   Initializes the Flask app.
    *   Registers all Blueprints from the `routes/` directory.
    *   Handles the Cloud Function request dispatch (`dcu_api`).

### 2. Routes (API Endpoints)
The API logic is split into domain-specific Blueprints in the `routes/` directory:

*   **`routes/races.py`**: CRUD operations for Races and the "Refresh Results" trigger.
*   **`routes/users.py`**: User profile management, signup, participants list, and detailed stats.
*   **`routes/league.py`**: League settings (points schemes) and global standings calculation.
*   **`routes/admin.py`**: Admin verification dashboard, trainer management/approval.
*   **`routes/integration.py`**: External OAuth flows (Strava + Zwift), webhook intake, and proxy endpoints (Zwift routes/segments, Clubs).
*   **`routes/seed.py`**: Tools for generating test data (participants, race results) for development.

### 3. Shared Extensions
*   **`extensions.py`**: Handles infrastructure initialization.
    *   Initializes Firebase Firestore (`db`).
    *   Manages Service Singletons (Zwift, Strava) to ensure efficient connection reuse.

### 4. Services & Business Logic
The core logic resides in the `services/` directory.

#### Results Processing Engine (`services/results/`)
The complex logic for calculating race results is organized into specialized components:

1.  **`ResultsProcessor.py`** (Orchestrator): 
    *   The main controller that coordinates the flow.
    *   Fetches race config -> Fetches data (via Fetcher) -> Calculates points (via Scorer) -> Saves to DB.
    *   Ensures that "Live Processing" and "Manual Recalculation" use identical logic.

2.  **`services/results/zwift_fetcher.py`**: 
    *   Handles all interactions with the Zwift API.
    *   Fetches event subgroups, finishers, and segment efforts.
    *   Normalizes raw API data into standard internal formats.

3.  **`services/results/race_scorer.py`**: 
    *   **Pure Business Logic**. Calculates points for a single race.
    *   Handles Finish Points, Sprint Points, Split Times.
    *   Applies Disqualifications (DQ) and Declassifications.
    *   Sorts riders based on Total Points and Finish Time.

4.  **`services/results/league_engine.py`**:
    *   **Single Source of Truth** for all league points calculations.
    *   Calculates per-race league points based on race type (see below).
    *   Aggregates results across all races for global standings.
    *   Applies "Best X Races" rules.
    *   Handles exclusion logic (e.g., must finish or score points to be listed).

#### League Points Calculation by Race Type

The `LeagueEngine` determines league points differently depending on the race type:

| Race Type | Ranking Criteria | Notes |
|-----------|------------------|-------|
| **time-trial** | `finishTime` (asc), or segment progress + `worldTime` for non-finishers | Fastest finisher wins. Non-finishers ranked by furthest segment reached, then by crossing time. |
| **scratch** | `finishTime` (asc) | Fastest finisher wins. DNF riders excluded from ranking. |
| **points** | `totalPoints` (desc), `finishRank` (asc) as tie-breaker | Highest points wins. Finish position breaks ties. |

For all race types:
*   DQ'd riders receive 0 league points.
*   Declassified riders are ranked after non-declassified riders.
*   Excluded riders are omitted entirely.
*   League points are assigned from the configured `leagueRankPoints` array (e.g., `[50, 48, 46, ...]`).

#### Integration Services
*   `services/zwift.py`: Official Zwift Developer API client (OAuth, Profile, Events, Subscriptions, Activity feed).
*   `services/zwiftracing.py`: Fetches ZP/ZR rating and phenotype data.
*   `services/strava.py`: Strava API integration (Activities, Streams, OAuth).
*   `services/zwift_game.py`: Static game data (Routes, Segments).

## Key Workflows

### Race Result Calculation
1.  **Trigger**: `POST /races/<id>/results/refresh`
2.  **Flow**:
    *   `routes/races.py` calls `ResultsProcessor.process_race_results()`.
    *   `ResultsProcessor` uses `ZwiftFetcher` to get live data.
    *   `ResultsProcessor` passes raw data to `RaceScorer` to assign points.
    *   Results are saved to Firestore (`races/{id}`).
    *   `ResultsProcessor` triggers `LeagueEngine` to update global standings.

### League Standings Update
1.  **Trigger**: Auto-triggered after race results, or manual `GET /league/standings`.
2.  **Flow**:
    *   Fetches all Race results and league settings from Firestore.
    *   `LeagueEngine` calculates league points for each race based on race type:
        *   **Time trials**: Ranked by finish time, or segment progress for non-finishers.
        *   **Scratch races**: Ranked by finish time (fastest wins).
        *   **Points races**: Ranked by total points (highest wins).
    *   Per-race league points are aggregated per rider.
    *   "Best X Races" logic applied if configured.
    *   Final standings table saved to Firestore (`league/standings`).

## Test Data & Seeding Module

The backend includes a dedicated module (`routes/seed.py`) for generating realistic test data. This is crucial for developing and testing the league logic without waiting for live Zwift events.

### Core Capabilities

1.  **Participant Seeding (`POST /admin/seed/participants`)**
    *   Generates `count` (default 20) fake users.
    *   Assigns realistic Danish names (e.g., "Magnus Nielsen", "Emma Hansen") and local cycling clubs.
    *   Creates corresponding Firestore documents with `isTestData: True` flag.

2.  **Race Result Simulation (`POST /admin/seed/results`)**
    *   Simulates race outcomes for specified race IDs.
    *   **Live Simulation Support**: Accepts a `progress` parameter (0-100%).
        *   If `progress < 100`: Generates intermediate results (sprints completed, but no finish times yet).
        *   If `progress = 100`: Generates full results with final finish times.
    *   **Randomized Performance**:
        *   Shuffles participants into different categories.
        *   Generates random finish times with realistic gaps.
        *   Generates random segment/sprint times.

3.  **Integration with Scoring Engine**
    *   Crucially, the seeder **does not calculate points itself**.
    *   It generates *raw* timing data (finish times, sprint elapsed times).
    *   It then calls the real `ResultsProcessor.recalculate_race_points()` method.
    *   This ensures that the **test data validates the actual business logic** used for live races.

## Development
*   **Requirements**: `requirements.txt`

## Run Backend Locally

The backend runs as a local Cloud Function through `functions-framework`.

### 1) Go to backend folder

```bash
cd backend
```

### 2) Create and activate a virtual environment (recommended)

Windows (PowerShell):

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

macOS/Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 3) Install dependencies

```bash
pip install -r requirements.txt
```

### 4) Configure environment variables

Create/update `backend/.env` with required secrets and local flags.

For local frontend usage, make sure this is set:

```env
ALLOW_LOCALHOST=true
```

### 5) Start backend on port 8080

```bash
python -m functions_framework --target dcu_api --source main.py --debug --port 8080
```

You should see output similar to:

- `Running on http://127.0.0.1:8080`
- `Debugger is active`

### 6) Quick verification

Open one of these in a browser:

- `http://127.0.0.1:8080/races`
- `http://127.0.0.1:8080/routes`

If those return JSON, the backend is running correctly.

## Data Inspection Tools

A utility script is available for easily inspecting Firestore data and outputting it as JSON (friendly for AI agents).

*   **Location**: `backend/scripts/inspect_data.py`
*   **Usage**:
    *   List collections: `python backend/scripts/inspect_data.py --list-collections`
    *   Get collection data: `python backend/scripts/inspect_data.py --collection <NAME>`

### Schema health check (read-only)

Use the schema health script to validate canonical structure and detect deprecated fields.

*   **Location**: `backend/scripts/schema_health_check.py`
*   **Usage**:
    *   `conda run -n py311 python backend/scripts/schema_health_check.py`

### Release gates

Run these checks before shipping schema/data-structure changes:

*   `conda run -n py311 python backend/scripts/schema_health_check.py`
*   `conda run -n py311 python -m pytest backend/tests`
*   (optional wrapper) `conda run -n py311 python backend/scripts/run_release_gates.py`

### Archival migration scripts

Migration scripts under `backend/scripts/migrate_*.py` are retained for historical one-time use only and are not part of routine maintenance.

Additional one-off cleanup/fix scripts are also archival (for example:
`consolidate_consents.py`, `consolidate_verification.py`,
`cleanup_verification_schema.py`, `fix_verification_status.py`,
`fix_auth_mappings.py`, `init_settings.py`).

## Firestore index configuration

The repository tracks Firestore index configuration at:

*   `firestore.indexes.json`

When composite indexes are introduced for new queries, update this file and deploy with Firebase CLI in your normal infra workflow.

## Admin Management Tools

Scripts are provided to manage user roles (specifically the `admin` custom claim) without direct database editing.

*   **Location**: `backend/scripts/`
*   **Check Admin Status**:
    *   `python backend/scripts/get_user_claims.py --email <USER_EMAIL>`
*   **Grant Admin Access**:
    *   `python backend/scripts/set_admin_claim.py --email <USER_EMAIL> --admin true`
*   **Revoke Admin Access**:
    *   `python backend/scripts/set_admin_claim.py --email <USER_EMAIL> --admin false`

## Zwift Integration

### OAuth & Profile

When a user connects their Zwift account via OAuth (`/zwift/callback`), the backend:

1. Exchanges the auth code for tokens (stored in `zwift_tokens/{userDocId}`)
2. Fetches `GET /api/link/racing-profile?includeCompetitionMetrics=true`
3. Stores all `competitionMetrics` fields in `zwiftProfile` on the user document:

| Field | Description |
|---|---|
| `ftp` | Functional Threshold Power (watts) |
| `zftp` | Zwift's calculated FTP — used for CE categorisation |
| `zmap` | Zwift's Maximal Aerobic Power (1-min) — used for CE categorisation |
| `racingScore` | Official Zwift Racing Score |
| `powerCompoundScore` | Proprietary combined power metric |
| `vo2max` | Estimated VO2max |
| `category` | Zwift CE category (mixed-gender) |
| `categoryWomen` | Zwift CE category (women's events) |
| `weightInGrams` | Rider weight at time of snapshot |

4. Automatically subscribes the user to `activity` and `racing-score` webhooks

### Webhooks (`POST /zwift/webhook`)

All incoming payloads are logged to the `zwift_webhooks` Firestore collection regardless of type.

| `notificationType` | Action |
|---|---|
| `ActivitySaved` | Fetches and stores full activity via `/api/thirdparty/activity/{activityId}` |
| `RacingScoreUpdated` | Re-fetches `competitionMetrics` → `zwiftProfile` **and** `power-profile` → `zwiftPowerCurve`. Both racing-score and power-curve subscriptions fire this type (confirmed from official docs) |
| `UserDisconnected` | Deletes the user's `zwift_tokens` doc and clears `connections.zwift` |
| `WorkoutProgressChanged` | Logged only, not handled |

### Nightly Stats Refresh

A GitHub Actions cron job runs nightly at **03:00 UTC** (`POST /admin/refresh-zr-stats`):
- Batch-fetches **ZwiftRacing** (vELO) stats for all registered riders
- Updates `zwiftRacing.currentRating`, `max30Rating`, `max90Rating`, `phenotype`
- Re-evaluates liga category status based on new `max30Rating`

Note: `competitionMetrics` (FTP, zFTP, etc.) is kept current via the `RacingScoreUpdated` webhook, not the nightly job.

### Backfill for Existing Users (`POST /admin/refresh-zwift-profile`)

Run this once after deploy to backfill users who connected Zwift before the full metrics + subscriptions were in place. For each user with a valid token it:
- Re-fetches and stores all `competitionMetrics` fields into `zwiftProfile`
- Re-fetches and stores the full `power-profile` into `zwiftPowerCurve`
- Subscribes them to `activity`, `racing-score`, and `power-curve` webhooks

Accepts an admin Firebase token or the scheduler secret. Idempotent — safe to run multiple times. Users whose refresh token has expired will be reported as `skipped` and would need to re-link Zwift.

```bash
curl -X POST https://<backend-url>/admin/refresh-zwift-profile \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  --data "{}"
```

Note (Cloud Functions / Google Front End): send an explicit body on POST (for
example `--data "{}"`). Without it, some clients may receive `411 Length Required`.

#### Chunked mode (recommended)

The endpoint supports chunked execution to avoid gateway timeouts on large backfills:

- `chunkSize` (default `25`, max `200`)
- `cursor` (document ID returned as `nextCursor`)
- `maxSeconds` (time budget per request, default `45`)
- `subscribe` (default `false`; set `true` only if you also want to force re-subscribe webhooks during backfill)

The endpoint returns:

- `processed`, `updated`, `skipped`, `errors`
- `timedOut`
- `nextCursor`
- `done`

Proven stable settings for production backfill:

- `chunkSize=25`
- `maxSeconds=40`
- `subscribe=false`

Example:

```bash
curl -X POST https://<backend-url>/admin/refresh-zwift-profile \
  -H "X-Scheduler-Token: <scheduler-secret>" \
  -H "Content-Type: application/json" \
  --data '{"chunkSize":25,"maxSeconds":40,"subscribe":false}'
```

