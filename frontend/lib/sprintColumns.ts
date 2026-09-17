import type { Race, Sprint } from '@/types/live';

const pickFirstNonEmpty = (...lists: (Sprint[] | undefined)[]): Sprint[] => {
    for (const list of lists) {
        if (Array.isArray(list) && list.length > 0) return list;
    }
    return [];
};

export function getConfiguredSprintsForCategory(
    race: Race | null | undefined,
    category: string | null | undefined,
): Sprint[] {
    if (!race) return [];
    const categoryName = String(category || '').trim();

    if (race.eventMode === 'grouped' && race.raceGroups?.length) {
        const group = race.raceGroups.find((g) => (g.categories || []).some((c) => c.category === categoryName));
        const catCfg = group?.categories?.find((c) => c.category === categoryName);
        const fallbackGroup = race.raceGroups.find((g) => (g.sprints || []).length > 0);
        return pickFirstNonEmpty(
            catCfg?.sprints,
            group?.sprints,
            fallbackGroup?.sprints,
            race.sprints,
            race.sprintData,
        );
    }

    if (race.eventMode === 'multi' && race.eventConfiguration?.length) {
        const catConfig = race.eventConfiguration.find((c) => c.customCategory === categoryName);
        return pickFirstNonEmpty(catConfig?.sprints, race.sprints, race.sprintData);
    }

    if (race.singleModeCategories?.length) {
        const catConfig = race.singleModeCategories.find((c) => c.category === categoryName);
        return pickFirstNonEmpty(catConfig?.sprints, race.sprints, race.sprintData);
    }

    return pickFirstNonEmpty(race.sprints, race.sprintData);
}

export function sprintConfigKey(sprint: Sprint): string | undefined {
    if (sprint.key) return sprint.key;
    if (sprint.id != null && sprint.count != null) return `${sprint.id}_${sprint.count}`;
    if (sprint.id != null) return String(sprint.id);
    return undefined;
}

export function resolveSprintColumns(
    configured: Sprint[],
    rows: Array<{ sprintDetails?: Record<string, unknown> }>,
): string[] {
    const present = new Set<string>();
    for (const row of rows) {
        if (!row.sprintDetails) continue;
        Object.keys(row.sprintDetails).forEach((key) => present.add(key));
    }

    const columns: string[] = [];
    const seen = new Set<string>();
    for (const sprint of configured) {
        const matched = [sprint.key, sprint.id != null && sprint.count != null ? `${sprint.id}_${sprint.count}` : undefined, sprint.id != null ? String(sprint.id) : undefined]
            .filter((key): key is string => Boolean(key))
            .find((key) => present.has(key));
        const key = matched || sprintConfigKey(sprint);
        if (!key || seen.has(key)) continue;
        columns.push(key);
        seen.add(key);
        present.delete(key);
    }
    for (const extra of [...present].sort()) {
        if (!seen.has(extra)) columns.push(extra);
    }
    return columns;
}
