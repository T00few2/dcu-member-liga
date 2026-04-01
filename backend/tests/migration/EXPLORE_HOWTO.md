# Zwift API Explorer — How to Run

Run from the `backend/` directory with credentials in your `.env` file.

## Required environment variables

```
ZWIFT_CLIENT_ID=...
ZWIFT_CLIENT_SECRET=...
```

## Optional environment variables

```
ZR_AUTH_KEY=...            # needed for ZwiftRacing.app endpoints
ZWIFT_API_BASE_URL=...     # defaults to https://us-or-rly101.zwift.com
ZWIFT_AUTH_BASE_URL=...    # defaults to https://secure.zwift.com/auth/realms/zwift
ZR_BASE_URL=...            # defaults to https://api.zwiftracing.app/api
```

---

## Commands

### Minimum — official endpoints only

```bash
python tests/migration/explore_zwift_api.py \
    --event-id <eventId> \
    --subgroup-id <subgroupId>
```

### Include ZwiftRacing.app + a specific rider

```bash
python tests/migration/explore_zwift_api.py \
    --event-id <eventId> \
    --subgroup-id <subgroupId> \
    --rider-id <zwiftId>
```

### Add user-token endpoints (racing profile, power curve, activity)

```bash
python tests/migration/explore_zwift_api.py \
    --event-id <eventId> \
    --subgroup-id <subgroupId> \
    --rider-id <zwiftId> \
    --user-token <userAccessToken> \
    --activity-id <activityId>
```

### Full picture — everything including legacy endpoints for comparison

```bash
python tests/migration/explore_zwift_api.py \
    --event-id <eventId> \
    --subgroup-id <subgroupId> \
    --rider-id <zwiftId> \
    --user-token <userAccessToken> \
    --activity-id <activityId> \
    --legacy
```

### Skip ZwiftRacing.app endpoints

```bash
python tests/migration/explore_zwift_api.py \
    --event-id <eventId> \
    --subgroup-id <subgroupId> \
    --skip-zr
```

---

## What to look for in the output

### segment-results (most important)

The script prints **one representative entry per unique `segmentId`** found in
the response. This tells you:

- Which `segmentId` is the finish line crossing (will have the largest
  `durationInMilliseconds` values matching overall race times)
- Which `segmentId`s are sprint segments
- Whether `avgWatts`, `endWorldTime`, `avgHeartRate` are populated in practice

### ZwiftPower results via ZwiftRacing

The script prints the field names from the first ZP result entry. Compare
these with the official segment-results fields to see if sprint times are
available there too.

---

## Where to find event/subgroup IDs

Event and subgroup IDs are visible in the Zwift event URL and in the race
config stored in Firestore under `races/{id}.eventId` /
`races/{id}.eventSubgroups`.
