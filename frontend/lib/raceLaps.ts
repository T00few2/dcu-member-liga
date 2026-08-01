import type { Race } from '@/types/live';

/**
 * Distinct lap counts across a race's categories/groups, highest first.
 * Inheritance: category.laps → group.laps → race.laps (same as admin UI).
 */
export function getAllLapsValues(race: Race): number[] {
    const laps = new Set<number>();
    const raceLaps = Math.max(1, race.laps || 1);

    if (race.eventMode === 'multi') {
        const cats = race.eventConfiguration || [];
        if (cats.length === 0) {
            laps.add(raceLaps);
        } else {
            cats.forEach((c) => {
                laps.add(Math.max(1, c.laps || raceLaps));
            });
        }
    } else if (race.eventMode === 'grouped') {
        const groups = race.raceGroups || [];
        if (groups.length === 0) {
            laps.add(raceLaps);
        } else {
            groups.forEach((g) => {
                const groupLaps = Math.max(1, g.laps || raceLaps);
                const cats = g.categories || [];
                if (cats.length === 0) {
                    laps.add(groupLaps);
                    return;
                }
                cats.forEach((c) => {
                    laps.add(Math.max(1, c.laps || groupLaps));
                });
            });
        }
    } else {
        const cats = race.singleModeCategories || [];
        if (cats.length === 0) {
            laps.add(raceLaps);
        } else {
            cats.forEach((c) => {
                laps.add(Math.max(1, c.laps || raceLaps));
            });
        }
    }

    if (laps.size === 0) laps.add(raceLaps);
    return Array.from(laps).sort((a, b) => b - a);
}

/** Public / uncategorized card: "3/2". Categorized rider: their own laps. */
export function formatOmgangeDisplay(
    race: Race,
    options: { userCategory?: string | null; categoryLaps?: number; forceUnion?: boolean } = {},
): string {
    const { userCategory, categoryLaps, forceUnion } = options;
    if (forceUnion || !userCategory) {
        return getAllLapsValues(race).join('/');
    }
    return String(Math.max(1, categoryLaps || race.laps || 1));
}
