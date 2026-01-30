# DCU e-Cycling League - Frontend

A Next.js application for managing and displaying live race results and league standings for the DCU e-Cycling Member League.

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4
- **Database**: Firebase Firestore
- **Authentication**: Firebase Auth
- **Charts**: Recharts

## Getting Started

### Prerequisites

- Node.js 18+
- npm/yarn/pnpm

### Installation

```bash
npm install
```

### Environment Variables

Create a `.env.local` file:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_auth_domain
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_storage_bucket
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
NEXT_PUBLIC_API_URL=http://localhost:8080
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Build

```bash
npm run build
npm start
```

---

## Project Structure

```
frontend/
├── app/                    # Next.js App Router pages
│   ├── admin/              # Admin dashboard
│   ├── live/               # Live dashboard & race views
│   │   ├── page.tsx        # Dashboard generator
│   │   └── [raceId]/       # Live race/standings display
│   ├── participants/       # Registered participants
│   ├── register/           # Registration page
│   ├── results/            # Results page
│   ├── schedule/           # Race schedule
│   └── stats/              # Statistics
├── components/             # React components
│   ├── admin/              # Admin components
│   ├── live/               # Live display components
│   ├── live-dashboard/     # Dashboard generator components
│   └── ...                 # Shared components
├── hooks/                  # Custom React hooks
├── lib/                    # Utilities & context
├── types/                  # TypeScript definitions
└── public/                 # Static assets
```

---

## Pages

### Public Pages

| Route | Description |
|-------|-------------|
| `/` | Home page |
| `/schedule` | Upcoming race schedule |
| `/results` | Past race results |
| `/participants` | Registered participants |
| `/register` | Registration form |
| `/stats` | League statistics |

### Admin Pages

| Route | Description |
|-------|-------------|
| `/admin` | Admin dashboard (requires authentication) |

### Live Display Pages

| Route | Description |
|-------|-------------|
| `/live` | Live dashboard generator - create overlay/full-screen URLs |
| `/live/[raceId]` | Live race results or standings display |

---

## Live Display System

The live display system is designed for streaming overlays (OBS) and full-screen displays.

### URL Parameters

| Parameter | Values | Description |
|-----------|--------|-------------|
| `cat` | Category name | Filter by category (e.g., `A`, `B`, `C`) |
| `view` | `race`, `standings`, `time-trial` | Display mode |
| `limit` | Number | Max rows to display |
| `cycle` | Seconds | Auto-switch between race/standings views |
| `full` | `true` | Full-screen mode with background |
| `transparent` | `false` | Disable transparent background |
| `scroll` | `true` | Enable auto-scrolling |
| `fit` | `true` | Scale table to fit screen |
| `banner` | `false` or URL | Show/hide or custom banner |
| `sprints` | `false` | Hide sprint columns |
| `lastSprint` | `true` | Show only last sprint |
| `lastSplit` | `true` | Show only last split (time-trial) |
| `nameMax` | Number | Truncate names to N characters |

### Overlay Color Parameters

Customize colors for OBS overlays:

| Parameter | Description |
|-----------|-------------|
| `text` | Base text color |
| `muted` | Muted/secondary text |
| `accent` | Accent color (points) |
| `positive` | Positive values (time, total) |
| `headerText` | Header text color |
| `headerBg` | Header background |
| `rowText` | Row text color |
| `rowBg` | Row background |
| `rowAltBg` | Alternating row background |
| `border` | Border color |
| `overlayBg` | Overall background |

### Example URLs

```
# Full-screen race results for category A
/live/race123?cat=A&full=true&fit=true

# OBS overlay with custom colors
/live/race123?cat=B&limit=10&text=%23ffffff&headerBg=%230f172a

# Auto-cycling standings/results
/live/race123?cat=A&cycle=30&full=true
```

---

## Components

### Admin Components

#### `LeagueManager`
Main admin component for managing races and league settings.

**Sub-components:**
- `RaceForm` - Create/edit race configuration
- `RaceList` - Display and manage races
- `ResultsModal` - View/edit race results (DQ, DC, EX)
- `LeagueSettingsForm` - Scoring configuration
- `TestDataPanel` - Generate test data
- `SegmentPicker` - Select sprints/splits

### Live Display Components

#### `RaceResultsTable`
Displays race results with finish position, time, points, sprints.

#### `TimeTrialTable`
Displays time-trial results with split times.

#### `StandingsTable`
Displays league standings with best-N calculation.

### Live Dashboard Components

#### `ConfigPanel`
URL configuration options (limit, cycle, transparency, etc.)

#### `OverlayColorPanel`
Color scheme selection and customization.

#### `LiveLinksMatrix`
Race × Category matrix with overlay/full-screen links.

#### `LiveResultsModal` / `CategoryResultsModal`
View and recalculate results from the dashboard.

---

## Hooks

| Hook | Purpose |
|------|---------|
| `useAuth` | Firebase authentication context |
| `useLeagueData` | Fetch races, routes, settings (admin) |
| `useRaceForm` | Race form state management |
| `useLiveRace` | Real-time race data subscription |
| `useLiveRaces` | Fetch races list with DQ/DC/EX handlers |
| `useLiveStandings` | Real-time standings subscription |
| `useOverlayConfig` | Overlay color configuration state |
| `useAutoScroll` | Auto-scrolling behavior |
| `useFitToScreen` | Scale-to-fit calculation |
| `useViewMode` | Race/standings view cycling |

---

## Types

### `types/admin.ts`
Types for admin functionality:
- `Race`, `Route`, `Segment`
- `EventConfig`, `CategoryConfig`
- `RaceResult`, `LeagueSettings`
- `RaceFormState`, `LoadingStatus`

### `types/live.ts`
Types for live display:
- `Race`, `ResultEntry`
- `StandingEntry`
- `OverlayConfig`

### `types/overlay.ts`
Types for overlay configuration:
- `OverlayColorScheme`
- `LiveConfig`
- Default palettes and constants

---

## Data Flow

### Race Results Calculation

1. Admin triggers "Calculate" from admin page or live dashboard
2. Backend fetches data from Zwift API
3. Results saved to Firebase `races/{raceId}`
4. Frontend receives real-time updates via Firestore listeners

### Standings Calculation

1. Standings computed from all races in `races` collection
2. Stored in `league/standings` document
3. Best-N races calculation done client-side for display

### Manual Adjustments

Admins can:
- **DQ (Disqualify)**: Rider gets 0 points
- **DC (Declassify)**: Rider gets last-place points
- **EX (Exclude)**: Rider removed from results

---

## Styling

### Theme Colors (Tailwind)

- Primary: Blue (`blue-500`, `blue-600`)
- Accent: Various (configurable for overlays)
- Background: Slate (`slate-800`, `slate-900`)
- Text: White/Slate variants

### Full-Screen Mode

- Blurred background image
- Semi-transparent card
- Responsive text sizing
- Optional banner display

### Overlay Mode

- Transparent or solid background
- Customizable via URL parameters
- Designed for OBS browser sources

---

## Firebase Collections

| Collection | Purpose |
|------------|---------|
| `races` | Race configuration and results |
| `participants` | Registered riders |
| `league/settings` | Scoring rules, league name |
| `league/standings` | Calculated standings |
| `league/liveOverlay` | Saved color schemes |

---

## Development Tips

### Adding a New Page

1. Create `app/your-page/page.tsx`
2. Use `'use client'` directive for interactive pages
3. Import hooks as needed

### Adding a New Component

1. Create in appropriate `components/` subfolder
2. Export from `index.ts` if in a grouped folder
3. Use TypeScript interfaces for props

### Adding a New Hook

1. Create in `hooks/` folder
2. Follow naming convention `use[Name].ts`
3. Use `useCallback`/`useMemo` for performance

---

## Deployment

### Vercel (Recommended)

1. Connect GitHub repository
2. Set environment variables
3. Deploy

### Manual Build

```bash
npm run build
npm start
```

---

## Related

- [Backend README](../backend/README.md) - API documentation
- [Zwift Racing API](https://www.zwift.com) - Data source
