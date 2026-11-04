import type { CriticalPower, Sprint } from '@/types/live';
import { ZWIFT_CATEGORY_COLORS } from '@/lib/ligaCategories';
import type {
    DivisionEffortRider,
    DivisionExclusionReason,
    DivisionPowerComparison,
    DivisionPowerRiderRow,
    DivisionPowerSummaryRow,
    PowerDurationKey,
    PowerUnit,
    SharedSprintComparisonGroup,
    SharedSprintComparisonRow,
} from './stats-types';
import { POWER_DURATION_KEYS } from './stats-types';

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

export const median = (values: number[]): number | null => {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[mid];
    return (sorted[mid - 1] + sorted[mid]) / 2;
};

const emptyExcluded = (): Record<DivisionExclusionReason, number> => ({
    dq: 0,
    declassified: 0,
    missingPower: 0,
    missingWeight: 0,
});

const displayDurationValues = (
    criticalPower: CriticalPower,
    weightKg: number | null,
    unit: PowerUnit,
): Record<PowerDurationKey, number> | null => {
    const values = {} as Record<PowerDurationKey, number>;
    for (const key of POWER_DURATION_KEYS) {
        const display = toDisplayPower(criticalPower[key], weightKg, unit);
        if (display === null) return null;
        values[key] = display;
    }
    return values;
};

export const formatExcludedRidersNote = (
    excluded: Record<DivisionExclusionReason, number>,
): string | null => {
    const parts: string[] = [];
    if (excluded.dq) parts.push(`${excluded.dq} diskvalificeret`);
    if (excluded.declassified) parts.push(`${excluded.declassified} deklassificeret`);
    if (excluded.missingPower) parts.push(`${excluded.missingPower} uden effektkurve`);
    if (excluded.missingWeight) parts.push(`${excluded.missingWeight} uden vægt`);
    const total = excluded.dq + excluded.declassified + excluded.missingPower + excluded.missingWeight;
    if (total === 0) return null;
    const noun = total === 1 ? 'rytter er udeladt' : 'ryttere er udeladt';
    return `${total} ${noun}: ${parts.join(', ')}.`;
};

export const formatOmittedSprintNote = (categories: string[]): string | null => {
    if (categories.length === 0) return null;
    if (categories.length === 1) return `${categories[0]} kørte et andet segment.`;
    const head = categories.slice(0, -1).join(', ');
    return `${head} og ${categories[categories.length - 1]} kørte et andet segment.`;
};

export const buildDivisionPowerComparison = (
    riders: DivisionEffortRider[],
    options: { unit: PowerUnit; categories: string[]; currentUserZwiftId?: string | null },
): DivisionPowerComparison => {
    const selected = new Set(options.categories);
    const meId = String(options.currentUserZwiftId || '').trim();
    const excluded = emptyExcluded();
    const included: DivisionPowerRiderRow[] = [];
    const seen = new Set<string>();

    for (const rider of riders) {
        const category = String(rider.category || '').trim();
        const zwiftId = String(rider.zwiftId || '').trim();
        if (!category || !zwiftId || !selected.has(category)) continue;
        const identity = `${category}:${zwiftId}`;
        if (seen.has(identity)) continue;
        seen.add(identity);

        if (rider.disqualified) {
            excluded.dq += 1;
            continue;
        }
        if (rider.declassified) {
            excluded.declassified += 1;
            continue;
        }
        if (!rider.criticalPower) {
            excluded.missingPower += 1;
            continue;
        }
        if (options.unit === 'wkg' && !(rider.weightKg && rider.weightKg > 0)) {
            excluded.missingWeight += 1;
            continue;
        }
        const values = displayDurationValues(rider.criticalPower, rider.weightKg, options.unit);
        if (!values) {
            excluded[options.unit === 'wkg' ? 'missingWeight' : 'missingPower'] += 1;
            continue;
        }
        included.push({
            zwiftId,
            name: rider.name,
            category,
            isMe: Boolean(meId) && zwiftId === meId,
            values,
        });
    }

    const summaries: DivisionPowerSummaryRow[] = [];
    for (const category of options.categories) {
        const rows = included.filter((rider) => rider.category === category);
        if (rows.length === 0) continue;
        const medianValues = {} as Record<PowerDurationKey, number>;
        const bestValues = {} as Record<PowerDurationKey, number>;
        for (const key of POWER_DURATION_KEYS) {
            const series = rows.map((rider) => rider.values[key]);
            medianValues[key] = median(series) ?? series[0];
            bestValues[key] = Math.max(...series);
        }
        summaries.push({
            category,
            riderCount: rows.length,
            median: medianValues,
            best: bestValues,
        });
    }

    return { riders: included, summaries, excluded };
};

const sprintOccurrenceKey = (sprint: Sprint): string | null => {
    const id = String(sprint.id ?? '').trim();
    if (!id) return null;
    if (sprint.count == null) return id;
    return `${id}_${sprint.count}`;
};

const sprintLabel = (sprint: Sprint): string => {
    const name = String(sprint.name || '').trim() || String(sprint.id);
    if (sprint.count == null) return name;
    return `${name} #${sprint.count}`;
};

const effortForSprint = (
    sprintData: DivisionEffortRider['sprintData'],
    sprint: Sprint,
): { timeMs: number; avgPower: number | null } | null => {
    if (!sprintData) return null;
    const keys = [
        sprint.key,
        sprint.id != null && sprint.count != null ? `${sprint.id}_${sprint.count}` : undefined,
        sprint.id != null ? String(sprint.id) : undefined,
    ].filter((key): key is string => Boolean(key));
    for (const key of keys) {
        const row = sprintData[key];
        if (!row) continue;
        const timeMs = parsePositiveNumber(row.time);
        if (timeMs === null) continue;
        return { timeMs, avgPower: parsePositiveNumber(row.avgPower) };
    }
    return null;
};

export const buildSharedSprintComparison = (
    sprintsByCategory: Record<string, Sprint[] | undefined>,
    riders: DivisionEffortRider[],
    options: { unit: PowerUnit; categories: string[] },
): SharedSprintComparisonGroup[] => {
    type Occurrence = {
        key: string;
        label: string;
        holders: Map<string, Sprint>;
    };
    const occurrences = new Map<string, Occurrence>();

    for (const category of options.categories) {
        for (const sprint of sprintsByCategory[category] ?? []) {
            const key = sprintOccurrenceKey(sprint);
            if (!key) continue;
            let occurrence = occurrences.get(key);
            if (!occurrence) {
                occurrence = { key, label: sprintLabel(sprint), holders: new Map() };
                occurrences.set(key, occurrence);
            }
            if (!occurrence.holders.has(category)) occurrence.holders.set(category, sprint);
        }
    }

    const groups: SharedSprintComparisonGroup[] = [];
    for (const occurrence of occurrences.values()) {
        if (occurrence.holders.size < 2) continue;
        const rows: SharedSprintComparisonRow[] = [];
        for (const category of options.categories) {
            const sprint = occurrence.holders.get(category);
            if (!sprint) continue;
            const times: number[] = [];
            const powers: number[] = [];
            const seen = new Set<string>();
            for (const rider of riders) {
                if (rider.category !== category || rider.disqualified || rider.declassified) continue;
                const zwiftId = String(rider.zwiftId || '').trim();
                if (!zwiftId || seen.has(zwiftId)) continue;
                seen.add(zwiftId);
                const effort = effortForSprint(rider.sprintData, sprint);
                if (!effort) continue;
                times.push(effort.timeMs / 1000);
                if (effort.avgPower !== null) {
                    const power = toDisplayPower(effort.avgPower, rider.weightKg, options.unit);
                    if (power !== null) powers.push(power);
                }
            }
            rows.push({
                category,
                riderCount: times.length,
                medianTimeSec: median(times),
                bestTimeSec: times.length > 0 ? Math.min(...times) : null,
                medianPower: median(powers),
            });
        }
        groups.push({
            key: occurrence.key,
            label: occurrence.label,
            rows,
            omittedCategories: options.categories.filter((category) => !occurrence.holders.has(category)),
        });
    }

    return groups;
};
