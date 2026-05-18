import type { CriticalPower, ResultEntry, Sprint, SprintPerformance } from '@/types/live';

export type StatsMode = 'all' | 'club';
export type SprintXAxisMode = 'rank' | 'time';

export type RiderWithCategory = ResultEntry & { category: string };
export type RiderWithPower = RiderWithCategory & { resolvedCriticalPower: CriticalPower };

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
    bestCp20: { riderName: string; watts: number } | null;
};

export type PowerLineStyle = {
    isMe: boolean;
    isTeammate: boolean;
    strokeColor: string;
    strokeWidth: number;
    opacity: number;
    name: string;
};
