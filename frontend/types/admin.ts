// Shared types for admin/league management
import type { StickyWattsResult } from '@/lib/stickyWatts';
import type { EventMode, ResultsPhase, RaceType, SegmentType } from './enums';
export type { EventMode, ResultsPhase, RaceType, SegmentType } from './enums';

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
    eventSecret?: string;
    customCategory: string;
    laps?: number;
    startTime?: string;
    sprints?: SelectedSegment[];
    segmentType?: 'sprint' | 'split';
}

export interface RaceGroupCategoryConfig {
    category: string;
    laps?: number;
    sprints?: SelectedSegment[];
    segmentType?: 'sprint' | 'split';
}

export interface RaceGroup {
    id: string;
    name: string;
    eventId: string;
    eventSecret?: string;
    categories: RaceGroupCategoryConfig[];
    laps?: number;
    sprints?: SelectedSegment[];
    segmentType?: 'sprint' | 'split';
}

export interface ResultsAutomationConfig {
    automationEnabled?: boolean;
    pollingIntervalMinutes?: number;
    windowStart?: string;
    windowEnd?: string;
    windowDurationMinutes?: number;
    finalizeDelayMinutes?: number;
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
    type?: RaceType;
    eventId?: string;
    eventSecret?: string;
    eventMode?: EventMode;
    linkedEventIds?: string[];
    eventConfiguration?: EventConfig[];
    singleModeCategories?: CategoryConfig[];
    raceGroups?: RaceGroup[];
    selectedSegments?: string[];
    sprints?: SelectedSegment[];
    segmentType?: SegmentType;
    results?: Record<string, RaceResult[]>;
    manualDQs?: string[];
    manualDeclassifications?: string[];
    manualExclusions?: string[];
    resultsPhase?: ResultsPhase;
    provisionalUpdatedAt?: string;
    finalizedAt?: string;
    finalizeRunId?: string;
    resultsAutomation?: ResultsAutomationConfig;
}

export interface SprintDataEntry {
    time?: number;      // elapsed time in ms
    worldTime?: number; // absolute worldTime
    avgPower?: number;
    rank?: number;
}

export interface CpDiffRow {
    label: string;
    key: string;
    zwift: number | null;
    strava: number | null;
    diffW: number;
    diffPct: number | null;
}

export type DualRecordingStatus = 'passed' | 'failed' | 'missing_strava' | 'missing_activity' | 'error' | 'sw_only';
export type WeightVerificationStatus = 'pending' | 'submitted' | 'approved' | 'rejected' | 'revoked' | 'none';

export interface DualRecordingVerification {
    status: DualRecordingStatus;
    passed?: boolean;
    verifiedAt?: string;
    activityId?: string;
    zwiftActivityId?: string;
    stravaActivityId?: number | null;
    failingMetrics?: string[];
    comparison?: {
        cpDiff: CpDiffRow[];
        avgPower: {
            zwift: number | null;
            strava: number | null;
            diffW: number | null;
            diffPct: number | null;
        };
        similarity?: {
            overlapSec: number;
            meanAbsDiffW?: number;
            stdDiffW?: number;
            stdDeltaDiffW?: number;
        };
    };
    stickyWatts?: StickyWattsResult | null;
    trainerName?: string | null;
}

export interface WeightVerificationRecord {
    userId?: string;
    zwiftId: string;
    name?: string;
    status: WeightVerificationStatus | string;
    requestId?: string;
    requestedAt?: string;
    submittedAt?: string;
    reviewedAt?: string;
    deadline?: string;
    rejectionReason?: string;
    raceId?: string;
    raceName?: string;
    matchSource?: 'explicit' | 'inferred' | string;
}

export interface RaceResult {
    zwiftId: string;
    name: string;
    finishTime: number;
    raceStatus?: string;
    finishRank: number;
    finishPoints: number;
    totalPoints: number;
    sprintDetails?: Record<string, number | string>;
    sprintData?: Record<string, SprintDataEntry>;
    flaggedCheating?: boolean;
    flaggedSandbagging?: boolean;
    activityId?: string;
    dualRecordingVerification?: DualRecordingVerification;
}

export interface LeagueSettings {
    name?: string;
    seasonStart?: string;   // ISO date string, e.g. "2025-03-01"
    gracePeriod?: number;   // Points above upper boundary before rider must move up (default 35)
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
    eventMode: 'single' | 'multi' | 'grouped';
    eventConfiguration: EventConfig[];
    singleModeCategories: CategoryConfig[];
    raceGroups: RaceGroup[];
    selectedMap: string;
    selectedRouteId: string;
    laps: number;
    selectedSprints: SelectedSegment[];
    segmentType: 'sprint' | 'split';
}

// Status type for loading states
export type LoadingStatus = 'idle' | 'loading' | 'saving' | 'seeding' | 'refreshing';

// Result source type
export type ResultSource = 'finishers' | 'live';
