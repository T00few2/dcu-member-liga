import type { CriticalPower, Race, Sprint } from '@/types/live';

export const STATS_PREFS_STORAGE_KEY = 'dcu-stats-page-preferences-v1';

const CATEGORY_RANK_DESC = [
    'Diamond', 'Ruby', 'Emerald', 'Sapphire', 'Amethyst', 'Platinum', 'Gold', 'Silver', 'Bronze', 'Copper',
    'A', 'B', 'C', 'D', 'E',
];

const CATEGORY_COLOR_PALETTE = [
    '#ef4444',
    '#22c55e',
    '#3b82f6',
    '#eab308',
    '#a855f7',
    '#06b6d4',
    '#f97316',
    '#14b8a6',
    '#ec4899',
    '#84cc16',
];

export const parsePositiveNumber = (value: unknown): number | null => {
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
    return null;
};

export const normalizeCriticalPower = (value: unknown): CriticalPower | null => {
    if (!value || typeof value !== 'object') return null;
    const source = value as Record<string, unknown>;

    const criticalP15Seconds = parsePositiveNumber(source.criticalP15Seconds ?? source.cp15s);
    const criticalP1Minute = parsePositiveNumber(source.criticalP1Minute ?? source.cp1min);
    const criticalP5Minutes = parsePositiveNumber(source.criticalP5Minutes ?? source.cp5min);
    const criticalP20Minutes = parsePositiveNumber(source.criticalP20Minutes ?? source.cp20min);

    if (
        criticalP15Seconds === null ||
        criticalP1Minute === null ||
        criticalP5Minutes === null ||
        criticalP20Minutes === null
    ) {
        return null;
    }

    return {
        criticalP15Seconds,
        criticalP1Minute,
        criticalP5Minutes,
        criticalP20Minutes,
    };
};

const pickFirstNonEmptySprints = (...lists: (Sprint[] | undefined)[]): Sprint[] => {
    for (const list of lists) {
        if (Array.isArray(list) && list.length > 0) return list;
    }
    return [];
};

export const getConfiguredSprintsForCategory = (race: Race | undefined, category: string | null): Sprint[] => {
    if (!race) return [];
    const categoryName = String(category || '').trim();

    if (race.eventMode === 'grouped' && race.raceGroups?.length) {
        const group = race.raceGroups.find((g) => (g.categories || []).some((c) => c.category === categoryName));
        const catCfg = group?.categories?.find((c) => c.category === categoryName);
        return pickFirstNonEmptySprints(catCfg?.sprints, group?.sprints, race.sprints, race.sprintData);
    }

    if (race.eventMode === 'multi' && race.eventConfiguration?.length) {
        const catConfig = race.eventConfiguration.find((c) => c.customCategory === categoryName);
        return pickFirstNonEmptySprints(catConfig?.sprints, race.sprints, race.sprintData);
    }

    if (race.singleModeCategories?.length) {
        const catConfig = race.singleModeCategories.find((c) => c.category === categoryName);
        return pickFirstNonEmptySprints(catConfig?.sprints, race.sprints, race.sprintData);
    }

    return pickFirstNonEmptySprints(race.sprints, race.sprintData);
};

export const categoryRankIndex = (category: string): number => {
    const idx = CATEGORY_RANK_DESC.findIndex(
        (name) => name.toLowerCase() === String(category || '').trim().toLowerCase(),
    );
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
};

export const normalizeCategoryKey = (category: unknown): string =>
    String(category || '').trim().toLowerCase();

export const buildCategoryColorMap = (categories: string[]): Record<string, string> => {
    const uniqueCategories = [...new Set(categories.map((c) => String(c || '').trim()).filter(Boolean))].sort();
    const map: Record<string, string> = {};
    uniqueCategories.forEach((category, index) => {
        map[category] = CATEGORY_COLOR_PALETTE[index % CATEGORY_COLOR_PALETTE.length];
    });
    return map;
};

export const formatTime = (ms: number) => {
    if (!ms) return '-';
    const totalSeconds = ms / 1000;
    return `${totalSeconds.toFixed(1)}s`;
};
