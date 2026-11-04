import type { CriticalPower, ResultEntry, Sprint, SprintPerformance } from '@/types/live';

export type StatsMode = 'all' | 'club' | 'divisions';
export type SprintXAxisMode = 'rank' | 'time';
export type PowerUnit = 'watts' | 'wkg';

export const POWER_DURATION_KEYS = [
    'criticalP15Seconds',
    'criticalP1Minute',
    'criticalP5Minutes',
    'criticalP20Minutes',
] as const;

export type PowerDurationKey = (typeof POWER_DURATION_KEYS)[number];

export const POWER_DURATION_LABELS: Record<PowerDurationKey, string> = {
    criticalP15Seconds: '15s',
    criticalP1Minute: '1m',
    criticalP5Minutes: '5m',
    criticalP20Minutes: '20m',
};

export type DivisionExclusionReason = 'dq' | 'declassified' | 'missingPower' | 'missingWeight';

export type DivisionEffortRider = {
    zwiftId: string;
    name: string;
    category: string;
    weightKg: number | null;
    disqualified?: boolean;
    declassified?: boolean;
    criticalPower: CriticalPower | null;
    sprintData?: Record<string, { avgPower?: number; time?: number } | undefined>;
};

export type DivisionPowerRiderRow = {
    zwiftId: string;
    name: string;
    category: string;
    isMe: boolean;
    values: Record<PowerDurationKey, number>;
};

export type DivisionPowerSummaryRow = {
    category: string;
    riderCount: number;
    median: Record<PowerDurationKey, number>;
    best: Record<PowerDurationKey, number>;
};

export type DivisionPowerComparison = {
    riders: DivisionPowerRiderRow[];
    summaries: DivisionPowerSummaryRow[];
    excluded: Record<DivisionExclusionReason, number>;
};

export type SharedSprintComparisonRow = {
    category: string;
    riderCount: number;
    medianTimeSec: number | null;
    bestTimeSec: number | null;
    medianPower: number | null;
};

export type SharedSprintComparisonGroup = {
    key: string;
    label: string;
    rows: SharedSprintComparisonRow[];
    omittedCategories: string[];
};

export type RiderWithCategory = ResultEntry & { category: string };
export type RiderWithPower = RiderWithCategory & {
    resolvedCriticalPower: CriticalPower;
    weightKg: number | null;
};

export type HiddenRiderIdsByMode = {
    all: string[];
    club: string[];
};

export type SprintScatterPoint = {
    id: string;
    name: string;
    category: string;
    time: number;
    rank: number;
    power: number;
    weightKg: number | null;
    isMe: boolean;
    color: string;
    opacity: number;
    size: number;
};

export type SprintAnalysisRow = {
    sprint: Sprint;
    sprintKey: string;
    sprintIndex: number;
    myData: SprintPerformance | null;
    scatterData: SprintScatterPoint[];
};

export type ClubSnapshot = {
    riderCount: number;
    avgRank: number | null;
    bestSprint: { label: string; riderName: string; timeSec: number } | null;
    bestCp20: { riderName: string; watts: number; weightKg: number | null } | null;
};

export type PowerLineStyle = {
    isMe: boolean;
    isTeammate: boolean;
    strokeColor: string;
    strokeWidth: number;
    opacity: number;
    name: string;
    tooltipName: string;
};
