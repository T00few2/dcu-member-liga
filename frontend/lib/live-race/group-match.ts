import type { RiderGroup } from '@/lib/live-race/cluster';

/** Stable key for matching the same logical group across polling re-clusters. */
export function groupRiderKey(group: RiderGroup): string {
    return group.riders
        .map((r) => r.userId)
        .sort()
        .join('|');
}

export function findSelectedGroupIndex(
    groups: RiderGroup[],
    selectedRiderIds: Set<string> | null | undefined,
): number {
    if (!groups.length) return -1;
    if (!selectedRiderIds || selectedRiderIds.size === 0) {
        return groups.length - 1;
    }
    let bestIdx = -1;
    let bestOverlap = 0;
    for (let i = 0; i < groups.length; i++) {
        let overlap = 0;
        for (const r of groups[i].riders) {
            if (selectedRiderIds.has(r.userId)) overlap += 1;
        }
        if (overlap > bestOverlap) {
            bestOverlap = overlap;
            bestIdx = i;
        }
    }
    return bestIdx >= 0 ? bestIdx : groups.length - 1;
}
