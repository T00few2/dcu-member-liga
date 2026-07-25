import type { SeasonRankPoints } from '@/types/admin';

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

export const SEASON_POINT_TABLE_LABELS: Record<(typeof SEASON_POINT_TABLE_KEYS)[number], string> = {
    tour_overall: 'Tour samlet (GC)',
    tour_stage: 'Tour-etape',
    monument: 'Monument',
    wt_classic: 'Stor WT-klassiker',
};
