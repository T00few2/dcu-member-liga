type SegmentRef = {
    key?: string;
    id?: string;
    count?: number;
};

type SegmentConfig = {
    segmentType?: 'sprint' | 'split';
    sprints?: SegmentRef[];
};

type RacePointsInput = {
    segmentType?: 'sprint' | 'split';
    sprints?: SegmentRef[];
    selectedSegments?: string[];
    singleModeCategories?: SegmentConfig[];
    eventConfiguration?: SegmentConfig[];
};

export interface RacePointsSplit {
    ridersCount: number;
    sprintSegments: number;
    finishTotal: number;
    sprintTotal: number;
    total: number;
    finishPct: number;
    sprintPct: number;
}

const getSegmentKey = (seg: SegmentRef): string | null => {
    if (seg?.key) return seg.key;
    if (seg?.id) return `${seg.id}_${seg.count ?? ''}`;
    return null;
};

const sum = (vals: number[]) => vals.reduce((acc, n) => acc + n, 0);

export const getSprintSegmentCountForPoints = (race: RacePointsInput): number => {
    const segmentKeys = new Set<string>();
    const defaultType = race.segmentType || 'sprint';

    if (defaultType !== 'split') {
        for (const key of race.selectedSegments || []) {
            segmentKeys.add(key);
        }
        for (const seg of race.sprints || []) {
            const key = getSegmentKey(seg);
            if (key) segmentKeys.add(key);
        }
    }

    for (const cfg of race.singleModeCategories || []) {
        if ((cfg.segmentType || defaultType) === 'split') continue;
        for (const seg of cfg.sprints || []) {
            const key = getSegmentKey(seg);
            if (key) segmentKeys.add(key);
        }
    }

    for (const cfg of race.eventConfiguration || []) {
        if ((cfg.segmentType || defaultType) === 'split') continue;
        for (const seg of cfg.sprints || []) {
            const key = getSegmentKey(seg);
            if (key) segmentKeys.add(key);
        }
    }

    return segmentKeys.size;
};

export const calculateRacePointsSplit = (
    race: RacePointsInput,
    finishPoints: number[] = [],
    sprintPoints: number[] = [],
    ridersCount?: number,
): RacePointsSplit => {
    const derivedRiders = ridersCount ?? 30;
    const riders = Math.max(1, derivedRiders);
    const sprintSegments = getSprintSegmentCountForPoints(race);

    const finishDist = finishPoints.slice(0, riders);
    const sprintDist = sprintPoints.slice(0, riders);

    const finishTotal = sum(finishDist);
    const sprintTotal = sum(sprintDist) * sprintSegments;
    const total = finishTotal + sprintTotal;

    return {
        ridersCount: riders,
        sprintSegments,
        finishTotal,
        sprintTotal,
        total,
        finishPct: total > 0 ? (finishTotal / total) * 100 : 0,
        sprintPct: total > 0 ? (sprintTotal / total) * 100 : 0,
    };
};

