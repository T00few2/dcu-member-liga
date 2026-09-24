import type { StandingEntry } from '@/types/live';

export type ClubCountingRider = {
    zwiftId: string;
    name: string;
    points: number;
};

export type ClubStandingRow = {
    club: string;
    points: number;
    riders: ClubCountingRider[];
};

/**
 * Club score is the sum of the three riders with the most season points.
 * Riders are taken from every division. The same rider counts once. A rider who
 * has been moved counts only in the division they are in now. Everyone else
 * counts at their higher total. Riders without a club are left out.
 */
export function buildClubStandings(
    standings: Record<string, StandingEntry[] | undefined>,
    clubByZwiftId: Map<string, string>,
    categoryByZwiftId?: Map<string, string>,
): ClubStandingRow[] {
    const bestByRider = new Map<string, { name: string; points: number }>();
    for (const [category, riders] of Object.entries(standings)) {
        for (const rider of riders || []) {
            const zwiftId = String(rider.zwiftId || '').trim();
            if (!zwiftId) continue;
            const points = Number(rider.totalPoints) || 0;
            const currentCategory = categoryByZwiftId?.get(zwiftId);
            if (currentCategory) {
                if (category !== currentCategory) continue;
                bestByRider.set(zwiftId, { name: rider.name || zwiftId, points });
                continue;
            }
            const current = bestByRider.get(zwiftId);
            if (!current || points > current.points) {
                bestByRider.set(zwiftId, { name: rider.name || zwiftId, points });
            }
        }
    }

    const byClub = new Map<string, ClubCountingRider[]>();
    for (const [zwiftId, rider] of bestByRider) {
        const club = (clubByZwiftId.get(zwiftId) || '').trim();
        if (!club) continue;
        const list = byClub.get(club) || [];
        list.push({ zwiftId, name: rider.name, points: rider.points });
        byClub.set(club, list);
    }

    const rows: ClubStandingRow[] = [];
    for (const [club, riders] of byClub) {
        const counting = [...riders]
            .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'da'))
            .slice(0, 3);
        rows.push({
            club,
            points: counting.reduce((sum, rider) => sum + rider.points, 0),
            riders: counting,
        });
    }
    rows.sort((a, b) => b.points - a.points || a.club.localeCompare(b.club, 'da'));
    return rows;
}
