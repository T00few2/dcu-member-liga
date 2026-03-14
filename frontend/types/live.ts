export interface Sprint {
    id: string;
    name: string;
    count: number;
    key?: string;
    lap?: number;
    direction?: string;
    type?: 'sprint' | 'split';
}

export interface ProfileSegment {
    name: string;
    type: 'sprint' | 'climb' | 'segment';
    fromKm: number;
    toKm: number;
    direction?: 'forward' | 'reverse';
}

export interface CategoryConfig {
    category: string;
    laps?: number;
    sprints?: Sprint[];
    segmentType?: 'sprint' | 'split';
}

export interface EventCategoryConfig {
    eventId: string;
    eventSecret?: string;
    customCategory: string;
    laps?: number;
    sprints?: Sprint[];
    segmentType?: 'sprint' | 'split';
    startTime?: string;
}

export interface ResultEntry {
    zwiftId: string;
    name: string;
    finishTime: number;
    finishRank?: number;
    finishPoints: number;
    sprintPoints?: number;
    totalPoints: number;
    sprintDetails?: Record<string, number | string>;
    sprintData?: Record<string, SprintPerformance>;
    criticalP?: CriticalPower;
}

export interface SprintPerformance {
    avgPower: number;
    time: number;
    rank: number;
}

export interface CriticalPower {
    criticalP15Seconds: number;
    criticalP1Minute: number;
    criticalP5Minutes: number;
    criticalP20Minutes: number;
}

export interface Race {
    id: string;
    name: string;
    date: string;
    routeId?: string;
    routeName?: string;
    map?: string;
    laps?: number;
    totalDistance?: number;
    totalElevation?: number;
    type?: 'scratch' | 'points' | 'time-trial';
    eventId?: string;
    eventSecret?: string;
    eventMode?: 'single' | 'multi';
    eventConfiguration?: EventCategoryConfig[];
    singleModeCategories?: CategoryConfig[];
    selectedSegments?: string[];
    results?: Record<string, ResultEntry[]>;
    sprints?: Sprint[];
    sprintData?: Sprint[];
    segmentType?: 'sprint' | 'split';
    profileSegments?: ProfileSegment[];
    manualDQs?: string[];
    manualDeclassifications?: string[];
    manualExclusions?: string[];
}

export interface StandingEntry {
    zwiftId: string;
    name: string;
    totalPoints: number;
    raceCount: number;
    results: { raceId: string; points: number }[];
    calculatedTotal?: number;
    pointsByRace?: Record<string, { points: number; isBest: boolean }>;
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
