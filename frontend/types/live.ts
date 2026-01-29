export interface Sprint {
    id: string;
    name: string;
    count: number;
    key: string;
    lap?: number;
    type?: 'sprint' | 'split';
}

export interface CategoryConfig {
    category: string;
    laps?: number;
    sprints?: Sprint[];
    segmentType?: 'sprint' | 'split';
}

export interface ResultEntry {
    zwiftId: string;
    name: string;
    finishTime: number;
    finishRank: number;
    finishPoints: number;
    totalPoints: number;
    sprintDetails?: Record<string, number | string>;
}

export interface Race {
    id: string;
    name: string;
    date: string;
    type?: 'scratch' | 'points' | 'time-trial';
    results?: Record<string, ResultEntry[]>;
    sprints?: Sprint[];
    sprintData?: Sprint[];
    segmentType?: 'sprint' | 'split';
    eventMode?: 'single' | 'multi';
    eventConfiguration?: {
        eventId: string;
        customCategory: string;
        sprints?: Sprint[];
        segmentType?: 'sprint' | 'split';
        startTime?: string;
    }[];
    singleModeCategories?: CategoryConfig[];
}

export interface StandingEntry {
    zwiftId: string;
    name: string;
    totalPoints: number;
    raceCount: number;
    results: { raceId: string, points: number }[];
    calculatedTotal?: number;
    pointsByRace?: Record<string, { points: number, isBest: boolean }>;
}

export interface OverlayConfig {
    enabled: boolean;
    text: string | null;
    muted: string | null;
    accent: string | null;
    positive: string | null;
    headerText: string | null;
    headerBg: string | null;
    rowText: string | null;
    rowBg: string | null;
    rowAltBg: string | null;
    border: string | null;
    background: string | null;
}
