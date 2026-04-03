# Zwift API Docs (Agent-Friendly)

Official Zwift API reference for this repository.

Official developer docs:
- https://docs.developer.zwift.com/

Base URLs:
- Production: `https://us-or-rly101.zwift.com`
- Auth: `https://secure.zwift.com/auth/realms/zwift`

---

## Agent Quick Index

Use this first. Pick endpoint by task.

| Task | Method + Path | Auth | Key Output |
|---|---|---|---|
| Event -> subgroup bridge | `GET /api/public/events/{eventId}` | None observed (public) | `eventSubgroups[].id` |
| Rider profile/category | `GET /api/link/racing-profile` | User token (`profile:read`, `fitness_metrics:read`) | `competitionMetrics` (ftp, zftp, zmap, racingScore, powerCompoundScore, vo2max, category, categoryWomen, weightInGrams), rider identity |
| Live race telemetry | `GET /api/link/events/subgroups/{subgroupId}/live-data` | App/User token | active riders + power/cadence/position |
| Race segment/finish data | `GET /api/link/events/subgroups/{subgroupId}/segment-results` | App/User token | `durationInMilliseconds`, `segmentId` |
| Activity details | `GET /api/thirdparty/activity/{activityId}` | User token (`activity`) | summary stats + `fitFileURL` |
| Power profile snapshot | `GET /api/link/power-curve/power-profile` | User token (`fitness_metrics:read`) | `zftp`, `zmap`, `category`, CP profile |
| Power curve recent window | `GET /api/link/power-curve/best/last?days=N` | User token | best efforts in last N days |
| Power curve by calendar year | `GET /api/link/power-curve/best/year/{year}` | User token | best efforts in specific year |
| Power curve all-time | `GET /api/link/power-curve/best/all-time` | User token | lifetime best efforts |
| Power curve single activity | `GET /api/link/power-curve/activity/{activityId}` | User token | best efforts from one activity |

---

## Task Playbooks

### If task is race results/scoring
1. Resolve subgroup IDs from `GET /api/public/events/{eventId}` -> `eventSubgroups[].id`
2. Fetch `segment-results` for each subgroup
3. Group by `segmentId`
4. Use `durationInMilliseconds` for timing/ranking
5. Use `eventSubgroupId` as subgroup integrity check

### If task is live broadcast/overlay
1. Poll `live-data` with `page`/`limit`
2. Use `asOf` to guard stale updates
3. Show telemetry (`powerOutputInWatts`, `heartRateInBpm`, `cadenceInRpm`)

### If task is rider profile/category checks
1. Fetch `racing-profile` with `includeCompetitionMetrics=true`
2. Use `userId` as canonical ID
3. Use `competitionMetrics.category` / `categoryWomen` / `racingScore`

### If task is activity post-processing
1. Fetch `activity/{activityId}`
2. Read `eventId` + `eventSubgroupId` if present
3. Download/process `fitFileURL` quickly (often short-lived)

### If task starts with only eventId
1. Call `GET /api/public/events/{eventId}`
2. Read `eventSubgroups[].id`
3. Call subgroup endpoints (`live-data`, `segment-results`) with those IDs
4. Keep a fallback path if endpoint behavior changes (this public path is not listed in developer docs)

---

## Canonical Field Conventions

- Identity:
  - Canonical rider ID: `userId` (UUID string)
  - Legacy numeric profile IDs may still appear in some payloads
- Timing:
  - Race/segment duration: `durationInMilliseconds`
  - Activity duration: `totalDurationInMilliSec`
- Grouping:
  - Race subgroup key: `eventSubgroupId`
  - Segment key: `segmentId`
- Power:
  - Instant/live: `powerOutputInWatts`
  - Segment average: `avgWatts`
  - Curve/profile: `zftp`, `zmap`, `powerCompoundScore`

---

## Endpoint Cards

## 0) GET `/api/public/events/{eventId}`

**Purpose**
- Resolve subgroup IDs when you start from event ID only.

**Auth**
- None observed (public endpoint).

**Request**
```bash
curl --request GET \
  --url https://us-or-rly101.zwift.com/api/public/events/:eventId
```

**Critical fields**
- Event key: `id`
- Subgroups: `eventSubgroups[]`
- Subgroup ID: `eventSubgroups[].id`

**Common pitfalls**
- This endpoint is useful in practice but is not listed in the official developer docs.
- Response visibility may depend on event visibility rules and timing.
- Keep a fallback strategy in case behavior changes.

---

## 1) GET `/api/link/racing-profile`

**Purpose**
- Get authenticated user racing profile and optional competition/social fields.

**Auth + Scopes**
- User token
- Required scopes: `profile:read`, `fitness_metrics:read`

**Useful query flags**
- `includeCompetitionMetrics=true`
- `includeSocialFacts=true`
- `includePartnerConnections=true`
- `includeAchievements=true`

**Request**
```bash
curl --request GET \
  --url https://us-or-rly101.zwift.com/api/link/racing-profile
```

**Critical fields**
- Identity: `userId`, `firstName`, `lastName`
- Status: `riding`, `currentActivityId`
- Category/scoring: `competitionMetrics.category`, `competitionMetrics.categoryWomen`, `competitionMetrics.racingScore`
- Physiology: `competitionMetrics.zftp`, `competitionMetrics.zmap`, `competitionMetrics.vo2max`

**Common pitfalls**
- Some objects are omitted unless include-flags are set.
- Respect `privacySettings` before exposing sensitive profile fields.

---

## 2) GET `/api/link/events/subgroups/{subgroupId}/live-data`

**Purpose**
- Real-time rider states for active participants in one event subgroup.

**Auth**
- App token or user token

**Request**
```bash
curl --request GET \
  --url https://us-or-rly101.zwift.com/api/link/events/subgroups/:subgroupId/live-data
```

**Response essentials**
- Top-level: `data[]`, `page`, `limit`
- Rider state: `userId`, `asOf`, `lap`, `distanceCovered`, `powerOutputInWatts`, `heartRateInBpm`, `cadenceInRpm`

**Common pitfalls**
- Finished riders may no longer appear in `data`.
- `avatar` / `position` can increase payload size.

---

## 3) GET `/api/link/events/subgroups/{subgroupId}/segment-results`

**Purpose**
- Cumulative segment results (finish/sprint/KOM segments) for subgroup.

**Auth**
- App token or user token

**Request**
```bash
curl --request GET \
  --url https://us-or-rly101.zwift.com/api/link/events/subgroups/:subgroupId/segment-results
```

**Response essentials**
- Top-level: `entries[]`, `cursor`
- Entry fields: `userId`, `segmentId`, `eventSubgroupId`, `durationInMilliseconds`, `endDate`, `endWorldTime`, `avgWatts`, `avgHeartRate`, `userBlocked`

**Common pitfalls**
- Cursor pagination required for full dataset.
- Must group by `segmentId`; one subgroup can contain many segments.

---

## 4) GET `/api/thirdparty/activity/{activityId}`

**Purpose**
- Fetch a single activity summary and downloadable FIT link.

**Auth + Scope**
- User token, scope `activity`

**Request**
```bash
curl --request GET \
  --url https://us-or-rly101.zwift.com/api/thirdparty/activity/:activityId
```

**Critical fields**
- Timing: `startDateTime`, `endDateTime`, `totalDurationInMilliSec`, `movingTimeInMs`
- Performance: `avgWatts`, `avgHeartRateinBPM`, `distanceInMeters`, `elevationInMeters`
- Event linkage: `eventId`, `eventSubgroupId`
- Artifacts: `fitFileURL`, `jsonFitFileURL`

**Common pitfalls**
- `fitFileURL` may be short-lived/single-use.
- `rideOnTimes` may require `includeRideOnTimes=true` in some API versions.

---

## 5) GET `/api/link/power-curve/power-profile`

**Purpose**
- Get rider power profile + category outputs.

**Auth + Scope**
- User token, scope `fitness_metrics:read`

**Request**
```bash
curl --request GET \
  --url https://us-or-rly101.zwift.com/api/link/power-curve/power-profile
```

**Critical fields**
- Core: `zftp`, `zmap`, `vo2max`, `validPowerProfile`
- Category: `category`, `categoryWomen`, `categoryIndex`, `categoryWomenIndex`
- Curve blocks: `cpBestEfforts.pointsWatts`, `cpBestEfforts.pointsWattsPerKg`
- Freshness: `metricsTimestamp`

---

## 6) GET `/api/link/power-curve/best/last?days={number}`

**Purpose**
- Best effort curve over recent N-day window.

**Auth**
- User token

**Request**
```bash
curl --request GET \
  --url 'https://us-or-rly101.zwift.com/api/link/power-curve/best/last?days=%3Cnumber%3E'
```

**Critical fields**
- `pointsWatts`
- `pointsWattsPerKg`
- `activityCountInRange`
- `finalActivityCountInRange`

---

## 7) GET `/api/link/power-curve/best/year/{year}`

**Purpose**
- Best effort curve for a specific calendar year.

**Auth**
- User token

**Request**
```bash
curl --request GET \
  --url https://us-or-rly101.zwift.com/api/link/power-curve/best/year/:year
```

**Notes**
- Response shape matches `best/last`.
- Useful for seasonal comparisons.

---

## 8) GET `/api/link/power-curve/best/all-time`

**Purpose**
- Lifetime best effort curve.

**Auth**
- User token

**Request**
```bash
curl --request GET \
  --url https://us-or-rly101.zwift.com/api/link/power-curve/best/all-time
```

**Notes**
- Response shape matches `best/last`.
- Good baseline for PB benchmark cards.

---

## 9) GET `/api/link/power-curve/activity/{activityId}`

**Purpose**
- Best effort curve derived from one specific activity.

**Auth**
- User token

**Request**
```bash
curl --request GET \
  --url https://us-or-rly101.zwift.com/api/link/power-curve/activity/:activityId
```

**Notes**
- Same curve schema as other power-curve endpoints.
- Best for race-by-race diagnostics and single-ride deep dives.

---

## Rate Limit Reminder

- Documented baseline: `250 requests/min` for `/api/thirdparty` and `/api/workout`.
- Handle `429` with backoff/retry.
- Watch `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`.

---

## For This Repository

When implementing integration logic here:
- Prefer `userId` over numeric IDs where available.
- For race scoring, treat `segment-results` as canonical source.
- For live overlays, use `live-data` only for currently active riders.
- Keep this file official-only; do not mix unofficial endpoint guidance here.
# Zwift API Documentation

*This document was extracted from the Zwift Developer Portal (https://docs.developer.zwift.com) for official Zwift API reference.*

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
The following `notificationType` values are sent to registered callback URLs:

| `notificationType` | Trigger | Handler implemented |
|---|---|---|
| `ActivitySaved` | Rider saves a new activity | ✅ Fetches and stores activity |
| `RacingScoreUpdated` | Rider's racing score / competition metrics updated | ✅ Re-fetches and stores all `competitionMetrics` into `zwiftProfile` |
| `PowerCurveUpdated` | Rider's power curve recalculated | ✅ Re-fetches and stores full `power-profile` into `zwiftPowerCurve` — **type unconfirmed, educated guess** |
| `UserDisconnected` | User disconnects the partner app from their Zwift account | ✅ Clears tokens and connection record |
| `WorkoutProgressChanged` | Status update for a scheduled workout | ❌ Not handled (irrelevant for race league) |

**Note:** `ActivitySaved`, `RacingScoreUpdated`, `UserDisconnected` are confirmed from `SubscriptionDto.subscriptionType` in the official schema. `PowerCurveUpdated` follows the same naming pattern but is unconfirmed — check the `zwift_webhooks` Firestore collection for the first received payload and update the webhook handler if the real type differs.
All raw webhook payloads are always logged to the `zwift_webhooks` Firestore collection regardless of type.

#### Subscription endpoints (per type)
- Activity: `POST/DELETE /api/thirdparty/activity/subscribe`
- Racing score: `POST/DELETE /api/thirdparty/racing-score/subscribe`
- Power curve: `POST/DELETE /api/thirdparty/power-curve/subscribe`
- Unsubscribe by userId (app credentials): `DELETE /api/thirdparty/{type}/subscribe/{userId}`

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

#### Racing Profile Example (Official API)

Request:

```bash
curl --request GET \
  --url https://us-or-rly101.zwift.com/api/link/racing-profile
```

Representative response shape:

```json
{
  "userId": "fdddaae1-1015-4bf4-8aaa-7d9e0d7e4ead",
  "id": 0,
  "firstName": "firstName",
  "lastName": "lastName",
  "male": true,
  "countryAlpha3": "usa",
  "weight": 0,
  "heightInMillimeters": 0,
  "racingAge": 0,
  "playerType": "CYCLIST",
  "currentActivityId": 0,
  "createdOn": "2024-08-25T15:00:00Z",
  "riding": true,
  "blocked": true,
  "privacySettings": {
    "approvalRequired": true,
    "displayWeight": true,
    "minor": true,
    "privateMessaging": true,
    "defaultFitnessDataPrivacy": true,
    "suppressFollowerNotification": true,
    "displayAge": true,
    "defaultActivityPrivacy": "FOLLOWERS_ONLY"
  },
  "achievements": {
    "achievementLevel": 0,
    "totalDistanceInMeters": 0,
    "totalDistanceClimbedInMeters": 0,
    "totalTimeInMinutes": 0
  },
  "partnerConnectionNames": [
    { "name": "STRAVA" }
  ],
  "socialFacts": {
    "followersCount": 0,
    "followeesCount": 0
  },
  "competitionMetrics": {
    "ftp": 300,              // Functional Threshold Power (watts)
    "zftp": 295,             // Zwift calculated FTP (used for CE categorisation)
    "zmap": 400,             // Zwift Maximal Aerobic Power (1-min sprint; used for CE categorisation)
    "racingScore": 250.7,    // Proprietary overall racing score
    "powerCompoundScore": 4.5, // Proprietary combined power metric (W/kg compound)
    "vo2max": 55.2,          // Estimated VO2max
    "category": "B",         // Zwift CE category (mixed-gender events)
    "categoryWomen": "A",    // Zwift CE category (women's events)
    "weightInGrams": 75000   // Rider weight at time of snapshot (grams)
  },
  "achievements": {          // only if includeAchievements=true
    "achievementLevel": 42,
    "totalDistanceInMeters": 50000000,
    "totalDistanceClimbedInMeters": 500000,
    "totalTimeInMinutes": 18000,
    "totalMetersInKomJersey": 1000000,
    "totalMetersInSprintersJersey": 500000,
    "totalMetersInOrangeJersey": 200000,
    "totalWattHours": 250000,
    "totalExperiencePoints": 800000,
    "totalGold": 5000000,
    "runAchievementLevel": 10,
    "totalRunDistance": 500000,
    "totalRunTimeInMinutes": 3000,
    "totalRunExperiencePoints": 50000,
    "totalRunCalories": 25000,
    "runTime1miInSeconds": 420,
    "runTime5kmInSeconds": 1400,
    "runTime10kmInSeconds": 2900,
    "runTimeHalfMarathonInSeconds": 6300,
    "runTimeFullMarathonInSeconds": 13500
  }
}
```

#### Field Notes (Integration-Focused)

- **Identity fields:** Prefer `userId` (UUID). Treat numeric `id` as compatibility-only.
- **Name/identity UI:** `firstName`, `lastName`, and `imageSrc` can be used directly for profile cards.
- **Privacy flags:** `privacySettings` should be respected before showing age/weight/activity visibility.
- **Status flags:** `riding`, `currentActivityId`, and `isLikelyInGame` are useful for "online now" indicators.
- **Category/ranking data:** `competitionMetrics.category`, `categoryWomen`, and `racingScore` are key for league seeding and category checks.
- **Power model:** `ftp`, `zftp`, `zmap`, and `vo2max` are useful for performance analytics or eligibility rules.
- **Social/connected services:** `socialFacts` and `partnerConnectionNames` are optional unless requested with include flags.

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

#### Live Data Example (Official API)

Request:

```bash
curl --request GET \
  --url https://us-or-rly101.zwift.com/api/link/events/subgroups/:subgroupId/live-data
```

Representative response shape:

```json
{
  "data": [
    {
      "userId": "00000000-0000-0000-0000-000000000000",
      "currentActivityId": 0,
      "currentEventSubgroupId": 0,
      "asOf": 0,
      "totalDistanceInMeters": 0,
      "distanceCovered": 0,
      "speedInMillimetersPerHour": 0,
      "elevationClimbedInMeters": 0,
      "rideDurationInSeconds": 0,
      "lap": 0,
      "cadenceInRps": 0,
      "cadenceInRpm": 0,
      "heartRateInBpm": 0,
      "powerOutputInWatts": 0,
      "draftSavings": 0,
      "pairedSteering": true,
      "routeDistanceInCentimeters": 0,
      "currentSport": "currentSport",
      "powerSourceType": "powerSourceType",
      "powerSourceModel": "powerSourceModel",
      "avatar": {
        "bodyType": 0,
        "hair": 0,
        "beard": 0,
        "glasses": 0,
        "socksColor": 0,
        "bikeFrameHash": 0,
        "frontWheelHash": 0,
        "rearWheelHash": 0,
        "bikeStyleParams_1": 0,
        "bikeStyleParams_2": 0,
        "jersey": 0,
        "helmet": 0,
        "shoes": 0,
        "socks": 0,
        "gloves": 0,
        "runShirtHash": 0,
        "runShortsHash": 0,
        "runShoesHash": 0,
        "runSocksHash": 0,
        "runHeadAccessoryHash": 0
      },
      "position": {
        "x": 0,
        "y": 0,
        "z": 0,
        "heading": 0
      }
    }
  ],
  "page": 0,
  "limit": 0
}
```

#### Live Data Field Notes (Integration-Focused)

- **Scope:** Returns only riders currently active in that subgroup (finished riders often disappear from this feed).
- **Identity join key:** `userId` (UUID) should be treated as canonical identifier for stream matching.
- **Time freshness:** `asOf` indicates snapshot time; use it to discard stale updates in overlays.
- **Progress metrics:** `lap`, `distanceCovered`, `totalDistanceInMeters`, and `routeDistanceInCentimeters` are useful for live ranking visuals.
- **Performance telemetry:** `powerOutputInWatts`, `heartRateInBpm`, `cadenceInRpm`, and speed fields are useful for broadcast widgets.
- **Optional payload weight:** `avatar` and `position` are heavier fields; include only when needed for rendering/map views.

#### Practical Notes

- Poll with pagination (`page`, `limit`) for large fields/subgroups.
- If response has empty `data`, the subgroup may be inactive or finished.
- For final standings and finish times, pair this endpoint with `segment-results`.

#### Segment Results Example (Official API)

Request:

```bash
curl --request GET \
  --url https://us-or-rly101.zwift.com/api/link/events/subgroups/:subgroupId/segment-results
```

Representative response shape:

```json
{
  "entries": [
    {
      "id": 0,
      "userId": "00000000-0000-0000-0000-000000000000",
      "activityId": 0,
      "segmentId": 0,
      "eventSubgroupId": 0,
      "worldId": 0,
      "mapId": 0,
      "sport": "sport",
      "endWorldTime": 0,
      "endDate": "2024-08-25T15:00:00Z",
      "durationInMilliseconds": 0,
      "powerType": "powerType",
      "avgWatts": 0,
      "avgHeartRate": 0,
      "userBlocked": true
    }
  ],
  "cursor": "cursor"
}
```

#### Segment Results Field Notes (Integration-Focused)

- **Primary timing field:** `durationInMilliseconds` is the key value for ranking and finish-time comparisons.
- **Join keys:** `userId` links rider identity; `eventSubgroupId` confirms subgroup context.
- **Segment context:** `segmentId` tells which segment the row belongs to (finish segment vs intermediate sprint/KOM).
- **Chronology:** `endDate` and `endWorldTime` are useful for tie-breakers and sequence validation.
- **Performance context:** `avgWatts` and `avgHeartRate` are available for analytics/overlay enrichment.
- **Moderation flag:** `userBlocked` can be used to hide blocked riders in UI views.

#### Practical Notes

- This endpoint is cursor-paginated; keep requesting while `cursor` is present.
- A subgroup can contain multiple segment IDs; you often need to group rows by `segmentId`.
- For live-in-race position, combine with `live-data`; for final result logic, this is typically the canonical source.

---

## 3. Training API

### Activities APIs
- **Get User Activity**
  - **Method:** `GET`
  - **Endpoint:** `/api/thirdparty/activity/{activityId}`
  - **Description:** Retrieves activity details and the `.fit` file download URL.

#### Activity Example (Official API)

Request:

```bash
curl --request GET \
  --url https://us-or-rly101.zwift.com/api/thirdparty/activity/:activityId
```

Representative response shape:

```json
{
  "activityId": "activityId",
  "activityName": "Tempus Fugit in Watopia",
  "startDateTime": "2024-02-02T14:27:04.346Z",
  "endDateTime": "2024-02-02T14:57:14.386Z",
  "lastUpdatedAt": "2024-02-02T14:57:14.386Z",
  "totalDurationInMilliSec": 1800000,
  "movingTimeInMs": 1234,
  "avgWatts": 179.5,
  "avgHeartRateinBPM": 145,
  "avgCadenceInRotationsPerMinute": 77.3117,
  "avgSpeedInMetersPerSecond": 9.52723,
  "distanceInMeters": 25000.3,
  "elevationInMeters": 100.5,
  "calories": 581.366,
  "sport": "Cycling",
  "fitFileURL": "https://fitfile.com/fitfile123",
  "jsonFitFileURL": "https://api.zwift.com/activities/123/file/321",
  "activityCommentCount": 12,
  "activityRideOnCount": 78,
  "autoClosed": false,
  "clubId": "d7f968e5-9c48-41a9-acd6-06c3867fb6e6",
  "eventId": 123,
  "eventSubgroupId": 12345,
  "powerType": "Power Source",
  "percentageCompleted": 0.85,
  "rideOnTimes": [
    1,
    2,
    3
  ]
}
```

#### Activity Field Notes (Integration-Focused)

- **Time & duration:** `startDateTime`, `endDateTime`, `totalDurationInMilliSec`, and `movingTimeInMs` are the primary pacing/time fields.
- **Performance summary:** `avgWatts`, `avgHeartRateinBPM`, cadence, speed, distance, elevation, and calories are useful for post-race analytics.
- **Event linkage:** `eventId` and `eventSubgroupId` allow direct mapping from activity -> race/subgroup context.
- **Race context:** `powerType` and `percentageCompleted` help explain result quality and completion level.
- **Downloadables:** `fitFileURL` is the key artifact URL; `jsonFitFileURL` can be used for structured stream extraction workflows.
- **Engagement metadata:** `activityCommentCount` and `activityRideOnCount` are optional but useful for social/UX views.

#### Practical Notes

- `fitFileURL` is commonly short-lived or single-use; fetch close to download time.
- `rideOnTimes` may require an explicit query flag in some versions (`includeRideOnTimes=true`).
- This endpoint is user-token based; ensure token has the `activity` scope.

### Activities Webhook Notifications
- **Subscribe to Activities:** `POST /api/thirdparty/activity/subscribe`
- **Unsubscribe (Auth User):** `DELETE /api/thirdparty/activity/subscribe`
- **Unsubscribe (Client Credentials):** `DELETE /api/thirdparty/activity/subscribe/{userId}`

### Workouts APIs
- **Upload Workout:** `POST /api/workout/developer/workout` (Supports `.zwo` or JSON)
- **Get Workout:** `GET /api/workout/developer/workout/{workoutId}`
- **Delete Workout:** `DELETE /api/workout/developer/workout/{workoutId}`

### Power Curve & Profile APIs
- **Get User Power Profile**
  - **Method:** `GET`
  - **Endpoint:** `/api/link/power-curve/power-profile`
  - **Description:** Returns zFTP/zMAP/VO2max and derived category/power-profile details.

#### Power Profile Example (Official API)

Request:

```bash
curl --request GET \
  --url https://us-or-rly101.zwift.com/api/link/power-curve/power-profile
```

Representative response shape:

```json
{
  "zftp": 0,
  "zmap": 0,
  "vo2max": 0,
  "validPowerProfile": true,
  "cpBestEfforts": {
    "pointsWatts": {
      "180": { "value": 120, "date": "2023-10-01T12:00:00Z" },
      "900": { "value": 100, "date": "2023-10-01T12:00:00Z" },
      "1080": { "value": 95, "date": "2023-10-01T12:05:00Z" }
    },
    "pointsWattsPerKg": {
      "180": { "value": 2.7, "date": "2023-10-01T12:00:00Z" },
      "900": { "value": 1.9, "date": "2023-10-01T12:00:00Z" },
      "1080": { "value": 1.66, "date": "2023-10-01T12:05:00Z" }
    },
    "activityCountInRange": 0,
    "finalActivityCountInRange": 0
  },
  "relevantCpEfforts": [
    {
      "watts": 0,
      "wattsKg": 0,
      "cpTimestamp": "2024-08-25T15:00:00Z",
      "cpLabel": "20 min",
      "duration": 1200
    }
  ],
  "category": "B",
  "categoryWomen": "B",
  "categoryIndex": 2,
  "categoryWomenIndex": 2,
  "displayFemaleCategory": true,
  "powerCompoundScore": 0,
  "weightInGrams": 0,
  "metricsTimestamp": "2024-08-25T15:00:00Z"
}
```

#### Power Profile Field Notes (Integration-Focused)

- **Core metrics:** `zftp`, `zmap`, and `vo2max` are primary performance indicators.
- **Data quality:** `validPowerProfile` should gate UI labels and category enforcement decisions.
- **Category outputs:** `category`, `categoryWomen`, and index variants support automatic race-category mapping.
- **Compound score:** `powerCompoundScore` is useful for ranking/eligibility heuristics when zFTP alone is insufficient.
- **Effort curve:** `cpBestEfforts.pointsWatts` / `pointsWattsPerKg` provide time-bucketed best efforts (e.g. 180s, 900s, 1080s).
- **Representative efforts:** `relevantCpEfforts` gives human-readable CP snapshots for UI cards and explainability.
- **Timestamping:** `metricsTimestamp` helps detect stale profile calculations.

#### Practical Notes

- This endpoint is user-token based; require `fitness_metrics:read` scope.
- For trend views, combine this endpoint with `best/all-time` and `best/last`.
- Store values as snapshots if you need historical category-change tracking over time.

- **Get Best Power Curve (Last N Days)**
  - **Method:** `GET`
  - **Endpoint:** `/api/link/power-curve/best/last`
  - **Query Params:** `days` (number of days to include)

#### Best Last-N-Days Example (Official API)

Request:

```bash
curl --request GET \
  --url 'https://us-or-rly101.zwift.com/api/link/power-curve/best/last?days=%3Cnumber%3E'
```

Representative response shape:

```json
{
  "pointsWatts": {
    "180": {
      "value": 120,
      "date": "2023-10-01T12:00:00Z"
    },
    "900": {
      "value": 100,
      "date": "2023-10-01T12:00:00Z"
    },
    "1080": {
      "value": 95,
      "date": "2023-10-01T12:05:00Z"
    }
  },
  "pointsWattsPerKg": {
    "180": {
      "value": 2.7,
      "date": "2023-10-01T12:00:00Z"
    },
    "900": {
      "value": 1.9,
      "date": "2023-10-01T12:00:00Z"
    },
    "1080": {
      "value": 1.66,
      "date": "2023-10-01T12:05:00Z"
    }
  },
  "activityCountInRange": 0,
  "finalActivityCountInRange": 0
}
```

#### Best Last-N-Days Notes (Integration-Focused)

- `pointsWatts` and `pointsWattsPerKg` use duration-seconds as keys (`"180"`, `"900"`, etc.).
- `value` is the best effort in that window; `date` is when that effort occurred.
- `activityCountInRange` and `finalActivityCountInRange` are useful sanity checks for sparse data windows.
- Use this endpoint for recency-sensitive form/ranking dashboards; pair with `best/all-time` for baseline context.

- **Get Best Power Curve (Specific Year)**
  - **Method:** `GET`
  - **Endpoint:** `/api/link/power-curve/best/year/{year}`
  - **Path Param:** `year` (calendar year, e.g. `2025`)

#### Best-By-Year Example (Official API)

Request:

```bash
curl --request GET \
  --url https://us-or-rly101.zwift.com/api/link/power-curve/best/year/:year
```

Representative response shape:

```json
{
  "pointsWatts": {
    "180": {
      "value": 120,
      "date": "2023-10-01T12:00:00Z"
    },
    "900": {
      "value": 100,
      "date": "2023-10-01T12:00:00Z"
    },
    "1080": {
      "value": 95,
      "date": "2023-10-01T12:05:00Z"
    }
  },
  "pointsWattsPerKg": {
    "180": {
      "value": 2.7,
      "date": "2023-10-01T12:00:00Z"
    },
    "900": {
      "value": 1.9,
      "date": "2023-10-01T12:00:00Z"
    },
    "1080": {
      "value": 1.66,
      "date": "2023-10-01T12:05:00Z"
    }
  },
  "activityCountInRange": 0,
  "finalActivityCountInRange": 0
}
```

#### Best-By-Year Notes (Integration-Focused)

- Response shape matches `best/last`, but window is fixed to a full calendar year.
- Useful for season-over-season comparisons and yearly rider summaries.
- Keep all values as snapshots if you need historical reporting that is stable over time.

- **Get Best Power Curve (All-Time)**
  - **Method:** `GET`
  - **Endpoint:** `/api/link/power-curve/best/all-time`

#### Best-All-Time Example (Official API)

Request:

```bash
curl --request GET \
  --url https://us-or-rly101.zwift.com/api/link/power-curve/best/all-time
```

Representative response shape:

```json
{
  "pointsWatts": {
    "180": {
      "value": 120,
      "date": "2023-10-01T12:00:00Z"
    },
    "900": {
      "value": 100,
      "date": "2023-10-01T12:00:00Z"
    },
    "1080": {
      "value": 95,
      "date": "2023-10-01T12:05:00Z"
    }
  },
  "pointsWattsPerKg": {
    "180": {
      "value": 2.7,
      "date": "2023-10-01T12:00:00Z"
    },
    "900": {
      "value": 1.9,
      "date": "2023-10-01T12:00:00Z"
    },
    "1080": {
      "value": 1.66,
      "date": "2023-10-01T12:05:00Z"
    }
  },
  "activityCountInRange": 0,
  "finalActivityCountInRange": 0
}
```

#### Best-All-Time Notes (Integration-Focused)

- Response shape matches `best/last` and `best/year`.
- Use as baseline PB profile for rider cards and long-term benchmarking.
- Compare against `best/last` to detect current-form vs historical-best deltas.

- **Get Power Curve (Single Activity)**
  - **Method:** `GET`
  - **Endpoint:** `/api/link/power-curve/activity/{activityId}`
  - **Path Param:** `activityId` (specific Zwift activity identifier)

#### Activity Power Curve Example (Official API)

Request:

```bash
curl --request GET \
  --url https://us-or-rly101.zwift.com/api/link/power-curve/activity/:activityId
```

Representative response shape:

```json
{
  "pointsWatts": {
    "180": {
      "value": 120,
      "date": "2023-10-01T12:00:00Z"
    },
    "900": {
      "value": 100,
      "date": "2023-10-01T12:00:00Z"
    },
    "1080": {
      "value": 95,
      "date": "2023-10-01T12:05:00Z"
    }
  },
  "pointsWattsPerKg": {
    "180": {
      "value": 2.7,
      "date": "2023-10-01T12:00:00Z"
    },
    "900": {
      "value": 1.9,
      "date": "2023-10-01T12:00:00Z"
    },
    "1080": {
      "value": 1.66,
      "date": "2023-10-01T12:05:00Z"
    }
  },
  "activityCountInRange": 0,
  "finalActivityCountInRange": 0
}
```

#### Activity Power Curve Notes (Integration-Focused)

- Response shape matches other power-curve endpoints; interpretation stays consistent.
- Useful for race-by-race diagnostics and validating standout efforts in a specific activity.
- Ideal when you already have `activityId` from webhook/event context and want direct effort analysis.
- `activityCountInRange` fields are typically low/constant here since the scope is one activity.

### Workouts Scheduling
- **Upload and Schedule:** `POST /api/workout/developer/workout/schedule` (Uploads a new workout and schedules it in one call).
- **Schedule Existing:** `POST /api/workout/developer/workout/{workoutId}/schedule`
- **Update Schedule:** `PUT /api/workout/developer/workout/schedule/{scheduleId}`
- **Delete Schedule:** `DELETE /api/workout/developer/workout/schedule/{scheduleId}`
- **Get Schedule Progress:** `GET /api/workout/developer/workout/schedule/{scheduleId}/progress`

