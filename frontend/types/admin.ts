// Shared types for admin/league management

export interface Route {
    id: string;
    name: string;
    map: string;
    distance: number;
    elevation: number;
    leadinDistance: number;
    leadinElevation: number;
}

export interface Segment {
    id: string;
    name: string;
    count: number;
    direction: string;
    lap: number;
}

export interface SelectedSegment extends Segment {
    key: string;
    type?: 'sprint' | 'split';
}

export interface CategoryConfig {
    category: string;
    laps?: number;
    sprints?: SelectedSegment[];
    segmentType?: 'sprint' | 'split';
}

export interface EventConfig {
    eventId: string;
    eventSecret: string;
    customCategory: string;
    laps?: number;
    startTime?: string;
    sprints?: SelectedSegment[];
    segmentType?: 'sprint' | 'split';
}

export interface Race {
    id: string;
    name: string;
    date: string;
    routeId: string;
    routeName: string;
    map: string;
    laps: number;
    totalDistance: number;
    totalElevation: number;
    type?: 'scratch' | 'points' | 'time-trial';
    eventId?: string;
    eventSecret?: string;
    eventMode?: 'single' | 'multi';
    linkedEventIds?: string[];
    eventConfiguration?: EventConfig[];
    singleModeCategories?: CategoryConfig[];
    selectedSegments?: string[];
    sprints?: SelectedSegment[];
    segmentType?: 'sprint' | 'split';
    results?: Record<string, RaceResult[]>;
    manualDQs?: string[];
    manualDeclassifications?: string[];
    manualExclusions?: string[];
}

export interface RaceResult {
    zwiftId: string;
    name: string;
    finishTime: number;
    finishRank: number;
    finishPoints: number;
    totalPoints: number;
    sprintDetails?: Record<string, number | string>;
    leaguePoints?: number | null;
    flaggedCheating?: boolean;
    flaggedSandbagging?: boolean;
}

export interface LeagueSettings {
    name?: string;
    finishPoints: number[];
    sprintPoints: number[];
    leagueRankPoints?: number[];
    bestRacesCount: number;
}

// Race form state type
export interface RaceFormState {
    editingRaceId: string | null;
    name: string;
    date: string;
    raceType: 'scratch' | 'points' | 'time-trial';
    eventId: string;
    eventSecret: string;
    eventMode: 'single' | 'multi';
    eventConfiguration: EventConfig[];
    singleModeCategories: CategoryConfig[];
    selectedMap: string;
    selectedRouteId: string;
    laps: number;
    selectedSprints: SelectedSegment[];
    segmentType: 'sprint' | 'split';
}

// Status type for loading states
export type LoadingStatus = 'idle' | 'loading' | 'saving' | 'seeding' | 'refreshing';

// Result source type
export type ResultSource = 'finishers' | 'joined' | 'signed_up';
