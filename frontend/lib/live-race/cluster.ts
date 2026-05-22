import type { LiveRider } from '@/types/live';
import { chartKmFromLiveData, type LiveDataDistanceInput } from '@/lib/live-race/position';

export interface PositionedLiveRider extends LiveRider {
    chartKm: number;
    cumulativeKm: number;
    inLeadIn: boolean;
    totalDistanceM: number;
}

export interface RiderGroup {
    riders: PositionedLiveRider[];
    chartKm: number;
    gapToPrevM: number;
}

export function positionRiders(
    riders: LiveRider[],
    opts: {
        leadInKm: number;
        totalDistanceKm: number;
        lapLengthKm: number;
    },
): PositionedLiveRider[] {
    return riders.map((r) => {
        const input: LiveDataDistanceInput = {
            distanceCovered: r.distanceCovered,
            totalDistanceInMeters: r.totalDistanceInMeters ?? undefined,
            routeDistanceInCentimeters: r.routeDistanceInCentimeters ?? undefined,
            lap: r.lap,
        };
        const { chartKm, cumulativeKm, inLeadIn } = chartKmFromLiveData(input, {
            leadInKm: opts.leadInKm,
            totalDistanceKm: opts.totalDistanceKm,
            lapLengthKm: opts.lapLengthKm,
        });
        return {
            ...r,
            chartKm,
            cumulativeKm,
            inLeadIn,
            totalDistanceM: cumulativeKm * 1000,
        };
    });
}

export function clusterRiders(
    positioned: PositionedLiveRider[],
    gapMeters: number,
): RiderGroup[] {
    const sorted = [...positioned].sort((a, b) => a.totalDistanceM - b.totalDistanceM);
    const groups: RiderGroup[] = [];
    let cur: PositionedLiveRider[] = [];

    for (const r of sorted) {
        const prev = cur[cur.length - 1];
        if (!prev || r.totalDistanceM - prev.totalDistanceM <= gapMeters) {
            cur.push(r);
        } else {
            if (cur.length) groups.push(buildGroup(cur, groups));
            cur = [r];
        }
    }
    if (cur.length) groups.push(buildGroup(cur, groups));
    return groups;
}

function buildGroup(riders: PositionedLiveRider[], prior: RiderGroup[]): RiderGroup {
    const chartKm =
        riders.reduce((s, r) => s + r.chartKm, 0) / Math.max(1, riders.length);
    const prev = prior[prior.length - 1];
    const gapToPrevM = prev
        ? Math.max(0, chartKm * 1000 - prev.chartKm * 1000)
        : 0;
    return { riders, chartKm, gapToPrevM };
}
