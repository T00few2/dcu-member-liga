# Zwift API Documentation

*This document was extracted from the Zwift Developer Portal (https://docs.developer.zwift.com) for reference during the migration of Zwift and ZwiftPower endpoints.*

## 1. Overview

### API Environments
- **Production Base URL:** `https://us-or-rly101.zwift.com`
- **Sandbox Base URL:** `https://sandbox.zwift.com`

### Rate Limiting
- **Limit:** 250 requests per minute, tracked separately for `/api/thirdparty` and `/api/workout` endpoints.
- **Response Headers:**
  - `x-ratelimit-limit`: The limit of requests and the time window (in seconds).
  - `x-ratelimit-remaining`: The number of requests remaining in this time window.
  - `x-ratelimit-reset`: Time until the window resets (in seconds).
- **Graceful Handling:** Returns `429 Too Many Requests` when limits are exceeded.

### Webhook Callback Messages
The following event types are sent to registered callback URLs:
- `ActivitySaved`: Triggered when a user saves a new activity.
- `WorkoutProgressChanged`: Status updates for scheduled workouts.
- `UserDisconnected`: Triggered when a user disconnects the partner application from their Zwift account.

---

## 2. Community Racing API

### Profile APIs
- **Get User's Racing Profile**
  - **Method:** `GET`
  - **Endpoint:** `/api/link/racing-profile`
  - **Scopes:** `profile:read`, `fitness_metrics:read`
  - **Query Parameters:**
    - `includeSocialFacts` (boolean): Include user social data.
    - `includePartnerConnections` (boolean): Include connected accounts.
    - `includeCompetitionMetrics` (boolean): Include specific racing metrics.
    - `includeAchievements` (boolean): Include user achievements.

### Racing Score & Power Curve Subscriptions
- **Get Status:** `GET /api/thirdparty/[racing-score | power-curve]/subscribe`
- **Subscribe:** `POST /api/thirdparty/[racing-score | power-curve]/subscribe`
- **Unsubscribe:** `DELETE /api/thirdparty/[racing-score | power-curve]/subscribe`
- **Unsubscribe (Client Credentials):** `DELETE /api/thirdparty/[racing-score | power-curve]/subscribe/{userId}`

### Events Data
- **Get Live Player States**
  - **Method:** `GET`
  - **Endpoint:** `/api/link/events/subgroups/{subgroupId}/live-data`
  - **Description:** Real-time data of players currently in a subgroup.
- **Get Segment Results**
  - **Method:** `GET`
  - **Endpoint:** `/api/link/events/subgroups/{subgroupId}/segment-results`
  - **Description:** Cumulative results for race segments within an event.

---

## 3. Training API

### Activities APIs
- **Get User Activity**
  - **Method:** `GET`
  - **Endpoint:** `/api/thirdparty/activity/{activityId}`
  - **Description:** Retrieves activity details and the `.fit` file download URL.

### Activities Webhook Notifications
- **Subscribe to Activities:** `POST /api/thirdparty/activity/subscribe`
- **Unsubscribe (Auth User):** `DELETE /api/thirdparty/activity/subscribe`
- **Unsubscribe (Client Credentials):** `DELETE /api/thirdparty/activity/subscribe/{userId}`

### Workouts APIs
- **Upload Workout:** `POST /api/workout/developer/workout` (Supports `.zwo` or JSON)
- **Get Workout:** `GET /api/workout/developer/workout/{workoutId}`
- **Delete Workout:** `DELETE /api/workout/developer/workout/{workoutId}`

### Workouts Scheduling
- **Upload and Schedule:** `POST /api/workout/developer/workout/schedule` (Uploads a new workout and schedules it in one call).
- **Schedule Existing:** `POST /api/workout/developer/workout/{workoutId}/schedule`
- **Update Schedule:** `PUT /api/workout/developer/workout/schedule/{scheduleId}`
- **Delete Schedule:** `DELETE /api/workout/developer/workout/schedule/{scheduleId}`
- **Get Schedule Progress:** `GET /api/workout/developer/workout/schedule/{scheduleId}/progress`

---

### Migration Notes for ZwiftPower
- **Results:** Use the `/api/link/events/subgroups/{subgroupId}/segment-results` for race leaderboards.
- **Profiles:** Use `/api/link/racing-profile` with `includeCompetitionMetrics=true` to get a user's current racing score and category.
- **Live Tracking:** Use `/api/link/events/subgroups/{subgroupId}/live-data` for live race tracking and broadcast integrations.
