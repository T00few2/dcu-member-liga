import type { CurrentLiveRace, Sprint } from '@/types/live';

export interface LiveRaceCategoryTab {
    cat: string;
    label: string;
    groupName?: string;
    laps: number;
    sprints: Sprint[];
}

export interface LiveRaceCategoryTabGroup {
    groupName?: string;
    tabs: LiveRaceCategoryTab[];
}

function pickSprints(...candidates: (Sprint[] | undefined | null)[]): Sprint[] {
    for (const c of candidates) {
        if (c && c.length > 0) return c;
    }
    return [];
}

export function getLiveRaceCategoryTabs(race: CurrentLiveRace): LiveRaceCategoryTab[] {
    if (race.eventMode === 'grouped' && race.raceGroups?.length) {
        const tabs: LiveRaceCategoryTab[] = [];
        for (const group of race.raceGroups) {
            for (const cat of group.categories ?? []) {
                if (!cat?.category) continue;
                tabs.push({
                    cat: cat.category,
                    label: cat.category,
                    groupName: group.name || undefined,
                    laps: cat.laps ?? group.laps ?? race.laps ?? 1,
                    sprints: pickSprints(cat.sprints, group.sprints, race.sprints),
                });
            }
        }
        if (tabs.length) return tabs;
    }
    if (race.eventConfiguration?.length) {
        return race.eventConfiguration.map((cfg) => ({
            cat: cfg.customCategory,
            label: cfg.customCategory,
            laps: cfg.laps ?? race.laps ?? 1,
            sprints: pickSprints(cfg.sprints, race.sprints),
        }));
    }
    if (race.singleModeCategories?.length) {
        return race.singleModeCategories.map((cfg) => ({
            cat: cfg.category,
            label: cfg.category,
            laps: cfg.laps ?? race.laps ?? 1,
            sprints: pickSprints(cfg.sprints, race.sprints),
        }));
    }
    return [{ cat: 'A', label: 'A', laps: race.laps ?? 1, sprints: race.sprints ?? [] }];
}

export function groupLiveRaceCategoryTabs(tabs: LiveRaceCategoryTab[]): LiveRaceCategoryTabGroup[] {
    const buckets = new Map<string | undefined, LiveRaceCategoryTab[]>();
    const order: (string | undefined)[] = [];
    for (const t of tabs) {
        if (!buckets.has(t.groupName)) {
            buckets.set(t.groupName, []);
            order.push(t.groupName);
        }
        buckets.get(t.groupName)!.push(t);
    }
    return order.map((groupName) => ({
        groupName,
        tabs: buckets.get(groupName)!,
    }));
}
