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
*   **`routes/integration.py`**: External OAuth flows (Strava) and proxy endpoints (Zwift routes/segments, Clubs).
*   **`routes/seed.py`**: Tools for generating test data (participants, race results) for development.

### 3. Shared Extensions
*   **`extensions.py`**: Handles infrastructure initialization.
    *   Initializes Firebase Firestore (`db`).
    *   Manages Service Singletons (Zwift, Strava, ZwiftPower) to ensure efficient connection reuse.

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
    *   **Pure Business Logic**. Calculates global league standings.
    *   Aggregates results from all races.
    *   Applies "Best X Races" rules.
    *   Handles exclusion logic (e.g., must finish or score points to be listed).

#### Integration Services
*   `services/zwift.py`: Low-level Zwift API client (Profile, Events, Activity feed).
*   `services/zwiftpower.py`: Scrapes/Fetches historical power data from ZwiftPower.
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
    *   Fetches all Race results from Firestore.
    *   `LeagueEngine` processes the raw list.
    *   Points are summed, "Best X" logic applied.
    *   Final table saved to Firestore (`league/standings`).

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
*   **Environment**: Requires `serviceAccountKey.json` for Firebase Admin access locally.
*   **Credentials**: Sensitive credentials (`ZWIFT_USERNAME`, `ZWIFT_PASSWORD`, etc.) are loaded from `config.py` (ensure this file is secure/git-ignored if it contains secrets).
