import type { CriticalPower } from '@/types/live';
import { ZWIFT_CATEGORY_COLORS } from '@/lib/ligaCategories';
import type { PowerUnit } from './stats-types';

export { getConfiguredSprintsForCategory } from '@/lib/sprintColumns';

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

export const categoryRankIndex = (category: string, rankOrder: string[] = CATEGORY_RANK_DESC): number => {
    const idx = rankOrder.findIndex(
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
        const zwift = category.length === 1 ? ZWIFT_CATEGORY_COLORS[category.toUpperCase()] : undefined;
        map[category] = zwift?.backgroundColor ?? CATEGORY_COLOR_PALETTE[index % CATEGORY_COLOR_PALETTE.length];
    });
    return map;
};

export const formatTime = (ms: number) => {
    if (!ms) return '-';
    const totalSeconds = ms / 1000;
    return `${totalSeconds.toFixed(1)}s`;
};

export const parsePowerUnit = (value: string | null | undefined): PowerUnit => {
    return value === 'wkg' ? 'wkg' : 'watts';
};

export const parseWeightKg = (weightInGrams: unknown): number | null => {
    const grams = parsePositiveNumber(weightInGrams);
    if (!grams) return null;
    return grams / 1000;
};

export const toDisplayPower = (
    watts: unknown,
    weightKg: number | null | undefined,
    unit: PowerUnit,
): number | null => {
    const power = typeof watts === 'number'
        ? (Number.isFinite(watts) ? watts : null)
        : parsePositiveNumber(watts);
    if (power === null) return null;
    if (unit === 'watts') return power;
    if (!weightKg || weightKg <= 0) return null;
    return power / weightKg;
};

export const formatDisplayPower = (
    watts: unknown,
    weightKg: number | null | undefined,
    unit: PowerUnit,
): string => {
    return formatConvertedPower(toDisplayPower(watts, weightKg, unit), unit);
};

export const formatConvertedPower = (value: unknown, unit: PowerUnit): string => {
    if (value === null || value === undefined || value === '') return '—';
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) return '—';
    if (unit === 'watts') return `${Math.round(numeric)} W`;
    return `${numeric.toFixed(2)} W/kg`;
};

export const powerAxisLabel = (unit: PowerUnit): string => (unit === 'wkg' ? 'W/kg' : 'Watts');

export type PowerLegendGroup<T> = {
    key: string;
    label: string | null;
    entries: T[];
};

export const groupPowerLegendEntries = <T extends { rider: { category: string } }>(
    entries: T[],
    groupByCategory: boolean,
): PowerLegendGroup<T>[] => {
    if (!groupByCategory) {
        return [{ key: 'all', label: null, entries }];
    }

    const groups = new Map<string, T[]>();
    const order: string[] = [];
    for (const entry of entries) {
        const category = String(entry.rider.category || '').trim() || 'Ukendt';
        if (!groups.has(category)) {
            groups.set(category, []);
            order.push(category);
        }
        groups.get(category)!.push(entry);
    }

    return order.map((category) => ({
        key: category,
        label: category,
        entries: groups.get(category)!,
    }));
};
