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
    pollingIntervalSeconds?: number;
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
    stageRaceId?: string;
    stageIndex?: number;
    results?: Record<string, RaceResult[]>;
    manualDQs?: string[];
    manualDeclassifications?: string[];
    manualExclusions?: string[];
    resultsPhase?: ResultsPhase;
    /** Present when results were written by admin Testing seed. */
    resultsSource?: 'seed';
    provisionalUpdatedAt?: string;
    finalizedAt?: string;
    finalizeRunId?: string;
    finishAudit?: FinishAudit;
    resultsAutomation?: ResultsAutomationConfig;
    preRegisterAllowed?: boolean;
}

export type FinishAuditStatus = 'aligned' | 'mismatch' | 'unavailable';

export interface FinishAuditIssue {
    type?: string;
    name?: string;
    zwiftId?: string;
    activityId?: string;
    category?: string;
    derivedFinishTime?: number;
    officialDuration?: number;
    deltaMs?: number;
    officialRank?: number;
    detail?: string;
}

export interface FinishAudit {
    status?: FinishAuditStatus;
    summary?: string;
    checkedAt?: string;
    comparedCount?: number;
    alignedCount?: number;
    officialEntryCount?: number;
    subgroupCount?: number;
    issues?: FinishAuditIssue[];
}

export type SeasonClass = 'tour' | 'monument' | 'wt_classic';

export interface SeasonRankPointRange {
    from: number;
    to: number;
    points: number;
}

export interface SeasonRankPointTable {
    byPlace: number[];
    ranges?: SeasonRankPointRange[];
}

export interface SeasonRankPoints {
    tour_overall?: SeasonRankPointTable;
    tour_stage?: SeasonRankPointTable;
    monument?: SeasonRankPointTable;
    wt_classic?: SeasonRankPointTable;
}

export interface StageRaceStageSummary {
    id: string;
    name?: string;
    date?: string;
    stageIndex?: number;
    resultsPhase?: ResultsPhase;
    type?: RaceType;
}

export interface StageRace {
    id: string;
    name: string;
    seasonClass: SeasonClass;
    bestRacesCount: number;
    resultsPhase?: ResultsPhase;
    /** Event GC entries (same shape as league standings entries). */
    standings?: Record<string, Array<{
        zwiftId: string;
        name: string;
        totalPoints: number;
        raceCount: number;
        results: Array<{ raceId?: string | null; points: number }>;
    }>>;
    finalizedAt?: string;
    updatedAt?: string;
    stages?: StageRaceStageSummary[];
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
    swVerifiedAt?: string;
    activityId?: string;
    zwiftActivityId?: string;
    stravaActivityId?: number | null;
    failingMetrics?: string[];
    source?: 'mandatory' | 'opt_in' | string;
    raceId?: string;
    raceName?: string;
    archiveId?: string;
    archiveName?: string;
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
    weighInDate?: string;
    source?: string;
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

/** Template category row for season race defaults (no event IDs). */
export interface DefaultCategoryRow {
    category: string;
    laps?: number;
}

/** Template multi-mode row (maps to EventConfig.customCategory; eventId filled per race). */
export interface DefaultEventConfigRow {
    customCategory: string;
    laps?: number;
}

/** Template grouped race group (eventId filled per race). */
export interface DefaultRaceGroup {
    id: string;
    name: string;
    categories: { category: string }[];
    laps?: number;
}

export interface LeagueSettings {
    name?: string;
    seasonStart?: string;   // ISO date string, e.g. "2025-03-01"
    gracePeriod?: number;   // Points above upper boundary before rider must move up (default 35)
    finishPoints: number[];
    sprintPoints: number[];
    leagueRankPoints?: number[];
    bestRacesCount: number;
    seasonRankPoints?: SeasonRankPoints;
    seasonBestResultsCount?: number;
    ligaCategories?: { name: string; upper?: number | null; requiresVerification?: boolean }[];
    weightVerificationValidDays?: number;
    /** Season race defaults — cloned into new races; not stored on race docs. */
    defaultEventMode?: EventMode;
    defaultSingleCategories?: DefaultCategoryRow[];
    defaultEventConfiguration?: DefaultEventConfigRow[];
    defaultRaceGroups?: DefaultRaceGroup[];
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
    preRegisterAllowed: boolean;
}

// Status type for loading states
export type LoadingStatus = 'idle' | 'loading' | 'saving' | 'seeding' | 'refreshing';

// Result source type
export type ResultSource = 'finishers' | 'live';
