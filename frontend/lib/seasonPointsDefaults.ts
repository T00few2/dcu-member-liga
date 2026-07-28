import type { SeasonRankPointTable, SeasonRankPoints } from '@/types/admin';

/** Mirrors backend/services/results/season_points_defaults.py */
export const DEFAULT_SEASON_RANK_POINTS: SeasonRankPoints = {
    tour_overall: {
        byPlace: [1300, 1040, 880, 750, 620, 520, 425, 360, 295, 230, 190, 165, 140, 110, 100, 90, 85, 80, 70, 60],
        ranges: [
            { from: 21, to: 25, points: 50 },
            { from: 26, to: 30, points: 40 },
            { from: 31, to: 40, points: 35 },
            { from: 41, to: 50, points: 25 },
            { from: 51, to: 55, points: 20 },
            { from: 56, to: 60, points: 15 },
        ],
    },
    tour_stage: {
        byPlace: [210, 150, 110, 90, 70, 55, 45, 40, 35, 30, 25, 20, 15, 10, 5],
        ranges: [],
    },
    monument: {
        byPlace: [800, 640, 520, 440, 360, 280, 240, 200, 160, 135, 110, 95, 85, 65, 55, 50, 50, 50, 50, 50],
        ranges: [
            { from: 21, to: 25, points: 30 },
            { from: 26, to: 30, points: 30 },
            { from: 31, to: 40, points: 15 },
            { from: 41, to: 50, points: 15 },
            { from: 51, to: 55, points: 10 },
            { from: 56, to: 60, points: 5 },
        ],
    },
    wt_classic: {
        byPlace: [500, 400, 325, 275, 225, 175, 150, 125, 100, 85, 70, 60, 50, 40, 35, 30, 30, 30, 30, 30],
        ranges: [
            { from: 21, to: 25, points: 20 },
            { from: 26, to: 30, points: 20 },
            { from: 31, to: 40, points: 10 },
            { from: 41, to: 50, points: 10 },
            { from: 51, to: 55, points: 5 },
            { from: 56, to: 60, points: 3 },
        ],
    },
};

export const SEASON_POINT_TABLE_KEYS = [
    'tour_overall',
    'tour_stage',
    'monument',
    'wt_classic',
] as const;

export type SeasonPointTableKey = (typeof SEASON_POINT_TABLE_KEYS)[number];

export const SEASON_POINT_TABLE_LABELS: Record<SeasonPointTableKey, string> = {
    tour_overall: 'Tour samlet (GC)',
    tour_stage: 'Tour-etape',
    monument: 'Monument',
    wt_classic: 'Stor WT-klassiker',
};

/** Resolve prestige points for a 1-based place (mirrors backend points_for_place). */
export function pointsForPlace(table: SeasonRankPointTable | undefined | null, place: number): number {
    if (!table || place < 1) return 0;
    const byPlace = table.byPlace || [];
    if (place <= byPlace.length) return Number(byPlace[place - 1]) || 0;
    for (const band of table.ranges || []) {
        const lo = Number(band.from);
        const hi = Number(band.to);
        const pts = Number(band.points) || 0;
        if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
        if (lo <= place && place <= hi) return pts;
    }
    return 0;
}

export function maxPlaceInTable(table: SeasonRankPointTable | undefined | null): number {
    if (!table) return 0;
    let max = (table.byPlace || []).length;
    for (const band of table.ranges || []) {
        const to = Number(band.to);
        if (Number.isFinite(to) && to > max) max = to;
    }
    return max;
}

/** Expand byPlace + ranges into a dense 1..maxPlace array for table editing. */
export function expandSeasonTableToByPlace(
    table: SeasonRankPointTable | undefined | null,
    maxPlace?: number,
): number[] {
    const n = Math.max(maxPlace ?? 0, maxPlaceInTable(table));
    if (n < 1) return [];
    const out: number[] = [];
    for (let place = 1; place <= n; place++) {
        out.push(pointsForPlace(table, place));
    }
    return out;
}

/** Expand all season schemes to a shared row count (max across schemes). */
export function expandAllSeasonTables(
    src: SeasonRankPoints | undefined | null,
): Record<SeasonPointTableKey, number[]> {
    const base = src || DEFAULT_SEASON_RANK_POINTS;
    let maxPlace = 0;
    for (const key of SEASON_POINT_TABLE_KEYS) {
        maxPlace = Math.max(maxPlace, maxPlaceInTable(base[key] || DEFAULT_SEASON_RANK_POINTS[key]));
    }
    const out = {} as Record<SeasonPointTableKey, number[]>;
    for (const key of SEASON_POINT_TABLE_KEYS) {
        out[key] = expandSeasonTableToByPlace(base[key] || DEFAULT_SEASON_RANK_POINTS[key], maxPlace);
    }
    return out;
}

/** Trim trailing zeros so sparse columns don't inflate stored arrays unnecessarily. */
export function trimTrailingZeros(values: number[]): number[] {
    let end = values.length;
    while (end > 0 && (values[end - 1] === 0 || values[end - 1] == null)) end -= 1;
    return values.slice(0, end);
}
