# How routes work

Race setup, the elevation profile, and segment names come from two sources. The Zwift game dictionary says which arches are on a route, what they are called, and which jersey they wear. Sauce for Zwift draws the elevation line and places each arch in metres from the start banner.

Results do not come from either source. Finish time is the official race result. Segment points are the efforts Zwift recorded for the segment ids stored on the race when it was set up.

## Game dictionary

`ZwiftGameService.get_game_dictionary` loads `https://www.zwift.com/zwift-web-pages/gamedictionaryextended`.

- A route's segments are the `SEGMENTS` rows whose `onRoutes` contains that route id. `onRoutes` is one comma-separated string of route ids. `signature` is the id `segment-results` returns.
- Route names, lap length, and lead-in come from `ROUTES`: `name`, `distanceInMeters`, `leadinDistanceInMeters`. The route dropdown already uses these.
- Segment names use `archFriendlyName` on the forward row and `archFriendlyNameR` on the reverse row. If that field is missing, `name` is used with underscores turned into spaces. `jerseyName` is banner text and is not the label.
- The jersey file decides the marker. The folder is `WhiteOrangeTheme` on every icon, so the file name is what matters.
  - `GreenJersey_Icon.tga` and `DesertJersey_Icon.tga`: sprint. Fuego Flats wears the desert jersey.
  - A file name containing `Polka`, and `NationalForest_Jersey_Icon.tga`: KOM. That includes Zwift KOM, Box Hill, Breakaway Brae, Epic KOM, Alpe du Zwift, New York KOM, Leith Hill, and Titans Grove KOM.
  - `OrangeJersey_Icon.tga`, `Badge_Volcano.tga`, and `Badge_Jungle.tga`: segment markers. Volcano KOM, Bologna TT, Hilly Loop, and UCI COURSE stay on the route when `onRoutes` lists them.
  - `PurpleJersey_Icon.tga`: a power interval, not a sprint or a KOM.
  - No icon: not a sprint or a KOM. These rows are checkpoints and unnamed arches. They stay on the checklist when `onRoutes` lists them.

zwift-data does not correct a jersey. Breakaway Brae, Breakaway Brae Rev., and Prime Rev. are KOMs.

The dictionary does not give ride order, metres from the banner, or a second pass of the same arch. Neon Shore lists Alley Sprint once. Sauce lists that id in the pens and again at the finish.

## Sauce for Zwift

`backend/data/routes.json` and `backend/data/worlds/` are refreshed with:

```text
conda run -n py311 python backend/scripts/sync_sauce_data.py
```

- The elevation line walks the route manifest on the road curve. Height is `(z - seaLevel + eleOffset) / 100 * physicsSlopeScale` from `backend/data/worldlist.json`. A road percent is `percent * (nodeCount - 3) + 1`. This is `backend/services/sauce_elevation.py`.
- `route.segments` gives `id`, `offset` metres from the banner, and `distance`. A negative offset or `leadinOnly` is the pens and is drawn once. Other rows repeat once per lap.
- When the dictionary lists an id that `route.segments` omits, the position comes from that arch's road percent on the route manifest.
- Sauce has no sprint versus KOM field.

A route with no Sauce manifest has no line. No Sleep Till Brooklyn's manifest has no lead-in slices, so it has no pens.

## Race setup

The map and route dropdowns are `GET /routes`.

The checkbox list is `GET /segments`. It is the dictionary rows for that route, placed by Sauce, named from the dictionary. An orange jersey or a Volcano or Jungle badge is included when `onRoutes` contains the route. Sauce's lap-banner flag does not add or remove rows.

Champs-Élysées is a dictionary segment on Champs-Élysées, Champs-Élysées Run, Paris Toujours, and Heart of Montmartre. It is not on La Boucle. La Boucle is Lutece Sprint, Monceau Sprint, Montmartre KOM, and Tchou Tchou Sprint. The Champs-Élysées banner still sits on a road La Boucle rides, which is why a road walk used to offer it. The checklist does not.

"(finish)" is the last arch on the lap when that arch is one of the route's dictionary segments. Brooklyn Bridge KOM is the finish on No Sleep Till Brooklyn. UCI COURSE is the finish on Richmond UCI Worlds. On La Boucle the lap ends at the Champs-Élysées banner, which is not a dictionary segment of that route, so Tchou Tchou Sprint is not marked finish.

Only ticked rows score. The new list applies when a race is set up. Opening an existing race does not replace the ticks already stored on it.

## Profiles

The race card and the live chart both use the Sauce line. The race card draws the pens once, then one lap. The live chart and the countdown keep 0 at the start banner. Card distance and elevation stay the dictionary totals saved on the race.

Markers use the Sauce position, the dictionary name, and the jersey. Green and desert are sprints. Polka and the Titans Grove jersey are climbs. Orange and badge jerseys are drawn as segments. A saved `elevation_cache.profileSegments` list does not replace these markers.

## Results

Finish time is `activityData.durationInMilliseconds` from `race-results`. Segment efforts are `segment-results` rows whose `segmentId` is a sprint id stored on the race. Ranking is by `worldTime`. The stored sprint `type` is `sprint` or `split`. `split` is FAL and does not award sprint points. The jersey is stored separately, as `marker`, and is never written into `type`.

Fetch and points recalc do not rebuild the stored sprint list.

Season sprint and KOM totals read `marker` when the ticked row has one. Rows saved before that field existed still match the stored name to `elevation_cache.profileSegments`, then to `backend/data/zwift_segment_types.json`. Finalized races are not reclassified by running their old names through the live jersey list.

## What is not the route profile

Rider Strava login and dual-recording stay. They compare a rider's Zwift activity with their connected Strava activity. They are not the elevation line and they do not decide which segments a route has.
