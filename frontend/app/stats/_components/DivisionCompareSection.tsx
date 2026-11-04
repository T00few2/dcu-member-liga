'use client';

import { useMemo, useState } from 'react';
import {
    CartesianGrid,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';

import type { Race } from '@/types/live';
import {
    buildCategoryColorMap,
    buildDivisionPowerComparison,
    buildSharedSprintComparison,
    categoryRankIndex,
    formatConvertedPower,
    formatExcludedRidersNote,
    formatOmittedSprintNote,
    getConfiguredSprintsForCategory,
    normalizeCriticalPower,
    powerAxisLabel,
} from '../_lib/stats-helpers';
import {
    POWER_DURATION_KEYS,
    POWER_DURATION_LABELS,
    type DivisionEffortRider,
    type DivisionPowerRiderRow,
    type PowerDurationKey,
    type PowerUnit,
    type RiderWithCategory,
} from '../_lib/stats-types';
import { PowerUnitToggle } from './PowerUnitToggle';

type SortKey = 'name' | 'category' | PowerDurationKey;

type DivisionCompareSectionProps = {
    race: Race;
    riders: RiderWithCategory[];
    weightKgByZwiftId: Record<string, number>;
    currentUserZwiftId: string | null;
    rankOrder: string[];
    powerUnit: PowerUnit;
    setPowerUnit: (unit: PowerUnit) => void;
};

const formatSeconds = (seconds: number | null): string => {
    if (seconds == null || !Number.isFinite(seconds)) return '—';
    return `${seconds.toFixed(2)} s`;
};

export function DivisionCompareSection({
    race,
    riders,
    weightKgByZwiftId,
    currentUserZwiftId,
    rankOrder,
    powerUnit,
    setPowerUnit,
}: DivisionCompareSectionProps) {
    const [disabledCategories, setDisabledCategories] = useState<string[]>([]);
    const [showRiders, setShowRiders] = useState(false);
    const [sortKey, setSortKey] = useState<SortKey>('criticalP20Minutes');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

    const categories = useMemo(() => {
        const names = [...new Set(riders.map((rider) => String(rider.category || '').trim()).filter(Boolean))];
        return names.sort((a, b) => {
            const rank = categoryRankIndex(a, rankOrder) - categoryRankIndex(b, rankOrder);
            if (rank !== 0) return rank;
            return a.localeCompare(b, 'da');
        });
    }, [riders, rankOrder]);

    const selectedCategories = useMemo(
        () => categories.filter((category) => !disabledCategories.includes(category)),
        [categories, disabledCategories],
    );

    const effortRiders = useMemo<DivisionEffortRider[]>(() => {
        return riders.map((rider) => ({
            zwiftId: String(rider.zwiftId),
            name: rider.name,
            category: rider.category,
            weightKg: weightKgByZwiftId[String(rider.zwiftId)] ?? null,
            disqualified: Boolean(rider.disqualified),
            declassified: Boolean(rider.declassified),
            criticalPower: normalizeCriticalPower(rider.criticalP ?? rider),
            sprintData: rider.sprintData,
        }));
    }, [riders, weightKgByZwiftId]);

    const comparison = useMemo(() => {
        return buildDivisionPowerComparison(effortRiders, {
            unit: powerUnit,
            categories: selectedCategories,
            currentUserZwiftId,
        });
    }, [effortRiders, powerUnit, selectedCategories, currentUserZwiftId]);

    const sprintGroups = useMemo(() => {
        const sprintsByCategory = Object.fromEntries(
            selectedCategories.map((category) => [category, getConfiguredSprintsForCategory(race, category)]),
        );
        return buildSharedSprintComparison(sprintsByCategory, effortRiders, {
            unit: powerUnit,
            categories: selectedCategories,
        });
    }, [race, selectedCategories, effortRiders, powerUnit]);

    const categoryColorMap = useMemo(() => buildCategoryColorMap(categories), [categories]);
    const excludedNote = formatExcludedRidersNote(comparison.excluded);
    const yAxisLabel = powerAxisLabel(powerUnit);

    const meRider = useMemo(() => {
        for (const category of selectedCategories) {
            const match = comparison.riders.find((rider) => rider.isMe && rider.category === category);
            if (match) return match;
        }
        return null;
    }, [comparison.riders, selectedCategories]);

    const sortedRiders = useMemo(() => {
        const direction = sortDir === 'asc' ? 1 : -1;
        const ranked = [...comparison.riders].sort((a, b) => {
            if (sortKey === 'name') return a.name.localeCompare(b.name, 'da') * direction;
            if (sortKey === 'category') {
                const rank = categoryRankIndex(a.category, rankOrder) - categoryRankIndex(b.category, rankOrder);
                if (rank !== 0) return rank * direction;
                return a.name.localeCompare(b.name, 'da');
            }
            const delta = a.values[sortKey] - b.values[sortKey];
            if (delta !== 0) return delta * direction;
            return a.name.localeCompare(b.name, 'da');
        });
        return [
            ...ranked.filter((rider) => rider.isMe),
            ...ranked.filter((rider) => !rider.isMe),
        ];
    }, [comparison.riders, sortKey, sortDir, rankOrder]);

    const toggleCategory = (category: string) => {
        setDisabledCategories((current) => (
            current.includes(category)
                ? current.filter((name) => name !== category)
                : [...current, category]
        ));
    };

    const toggleSort = (key: SortKey) => {
        if (sortKey === key) {
            setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
            return;
        }
        setSortKey(key);
        setSortDir(key === 'name' || key === 'category' ? 'asc' : 'desc');
    };

    if (categories.length === 0) {
        return (
            <div className="p-6 bg-muted/20 rounded text-center text-muted-foreground">
                Ingen divisioner har effektkurver for dette løb.
            </div>
        );
    }

    return (
        <div className="space-y-8">
            <section>
                <div className="flex justify-between items-start mb-4 gap-3 flex-wrap">
                    <div>
                        <h2 className="text-2xl font-bold">Effekt på tværs af divisioner</h2>
                        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                            Median og bedste kritiske effekt. Sluttid og placering er ikke med, fordi divisionerne ikke nødvendigvis kører samme rute.
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            aria-pressed={showRiders}
                            onClick={() => setShowRiders((current) => !current)}
                            className={`text-xs px-3 py-1.5 rounded border border-input transition-colors ${showRiders ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted/60'}`}
                        >
                            Vis ryttere
                        </button>
                        <PowerUnitToggle value={powerUnit} onChange={setPowerUnit} />
                    </div>
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-2 mb-3">
                    {categories.map((category) => {
                        const checked = selectedCategories.includes(category);
                        return (
                            <label key={category} className="inline-flex items-center gap-2 text-sm cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleCategory(category)}
                                />
                                <span
                                    className="inline-block w-2.5 h-2.5 rounded-full"
                                    style={{ backgroundColor: categoryColorMap[category] }}
                                />
                                {category}
                            </label>
                        );
                    })}
                </div>
                {excludedNote && (
                    <p className="text-sm text-muted-foreground mb-4">{excludedNote}</p>
                )}

                {selectedCategories.length === 0 ? (
                    <div className="p-6 bg-muted/20 rounded text-center text-muted-foreground">
                        Vælg mindst én division.
                    </div>
                ) : comparison.riders.length === 0 ? (
                    <div className="p-6 bg-muted/20 rounded text-center text-muted-foreground">
                        Ingen divisioner har effektkurver for dette løb.
                    </div>
                ) : (
                    <div className="space-y-6">
                        <div className="bg-card border border-border p-6 rounded-lg shadow-sm">
                            <div className="relative h-[400px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart>
                                        <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                                        <XAxis dataKey="duration" type="category" allowDuplicatedCategory={false} tick={{ fontSize: 12 }} />
                                        <YAxis
                                            label={{ value: yAxisLabel, angle: -90, position: 'insideLeft' }}
                                            tick={{ fontSize: 12 }}
                                            tickFormatter={(value: number) => (
                                                powerUnit === 'wkg' ? Number(value).toFixed(1) : String(Math.round(Number(value)))
                                            )}
                                        />
                                        <Tooltip
                                            content={({ active, payload, label }) => {
                                                if (!(active && payload && payload.length)) return null;
                                                const rows = payload
                                                    .filter((entry) => entry && entry.name && !String(entry.name).startsWith('__rider__') && entry.value != null)
                                                    .sort((a, b) => {
                                                        if (a.name === 'Mig') return -1;
                                                        if (b.name === 'Mig') return 1;
                                                        return Number(b.value ?? 0) - Number(a.value ?? 0);
                                                    });
                                                if (rows.length === 0) return null;
                                                return (
                                                    <div className="bg-background border border-border p-2 rounded shadow text-sm">
                                                        <p className="font-bold mb-1">{label}</p>
                                                        {rows.map((row) => (
                                                            <p key={`${label}-${row.name}`} style={{ color: row.color }}>
                                                                {row.name}: {formatConvertedPower(row.value, powerUnit)}
                                                            </p>
                                                        ))}
                                                    </div>
                                                );
                                            }}
                                        />
                                        {showRiders && comparison.riders.filter((rider) => !rider.isMe).map((rider) => (
                                            <Line
                                                key={`dot-${rider.category}-${rider.zwiftId}`}
                                                data={POWER_DURATION_KEYS.map((key) => ({
                                                    duration: POWER_DURATION_LABELS[key],
                                                    value: rider.values[key],
                                                }))}
                                                type="monotone"
                                                dataKey="value"
                                                stroke={categoryColorMap[rider.category] || '#8884d8'}
                                                strokeWidth={0}
                                                dot={{ r: 2.5, fill: categoryColorMap[rider.category] || '#8884d8', fillOpacity: 0.45, strokeWidth: 0 }}
                                                activeDot={false}
                                                name={`__rider__${rider.category}-${rider.zwiftId}`}
                                                legendType="none"
                                                isAnimationActive={false}
                                                connectNulls={false}
                                            />
                                        ))}
                                        {comparison.summaries.map((summary) => (
                                            <Line
                                                key={summary.category}
                                                data={POWER_DURATION_KEYS.map((key) => ({
                                                    duration: POWER_DURATION_LABELS[key],
                                                    value: summary.median[key],
                                                }))}
                                                type="monotone"
                                                dataKey="value"
                                                stroke={categoryColorMap[summary.category] || '#8884d8'}
                                                strokeWidth={2.5}
                                                dot={false}
                                                name={summary.category}
                                                legendType="none"
                                                isAnimationActive={false}
                                                connectNulls={false}
                                            />
                                        ))}
                                        {meRider && (
                                            <Line
                                                key="me"
                                                data={POWER_DURATION_KEYS.map((key) => ({
                                                    duration: POWER_DURATION_LABELS[key],
                                                    value: meRider.values[key],
                                                }))}
                                                type="monotone"
                                                dataKey="value"
                                                stroke="#111827"
                                                strokeWidth={2}
                                                strokeDasharray="5 4"
                                                dot={{ r: 5, fill: '#111827', strokeWidth: 0 }}
                                                name="Mig"
                                                legendType="none"
                                                isAnimationActive={false}
                                                connectNulls={false}
                                            />
                                        )}
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center mt-4 text-xs text-muted-foreground">
                                {comparison.summaries.map((summary) => (
                                    <span key={summary.category} className="inline-flex items-center gap-1">
                                        <span className="inline-block w-6 border-t-2" style={{ borderColor: categoryColorMap[summary.category] }} />
                                        {summary.category}
                                    </span>
                                ))}
                                {meRider && (
                                    <span className="inline-flex items-center gap-1">
                                        <span className="inline-block w-6 border-t-2 border-dashed border-slate-900" />
                                        Mig
                                    </span>
                                )}
                            </div>
                            <p className="text-sm text-muted-foreground text-center mt-3">
                                Linjerne er medianen for hver division ({yAxisLabel}).
                            </p>
                        </div>

                        <div>
                            <h3 className="text-lg font-semibold mb-3">Divisionsoversigt</h3>
                            <div className="bg-card border border-border rounded-lg shadow-sm overflow-x-auto">
                                <table className="w-full text-left text-sm whitespace-nowrap">
                                    <thead className="bg-muted/40 text-muted-foreground">
                                        <tr>
                                            <th rowSpan={2} className="px-4 py-3 align-bottom">Division</th>
                                            <th rowSpan={2} className="px-4 py-3 text-right align-bottom">Ryttere</th>
                                            {POWER_DURATION_KEYS.map((key) => (
                                                <th key={key} colSpan={2} className="px-3 py-2 text-center font-semibold text-foreground">
                                                    {POWER_DURATION_LABELS[key]}
                                                </th>
                                            ))}
                                        </tr>
                                        <tr>
                                            {POWER_DURATION_KEYS.flatMap((key) => [
                                                <th key={`${key}-median`} className="px-3 py-2 text-right font-medium">Median</th>,
                                                <th key={`${key}-best`} className="px-3 py-2 text-right font-medium">Bedst</th>,
                                            ])}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {comparison.summaries.map((summary) => (
                                            <tr key={summary.category} className="border-t border-border">
                                                <td className="px-4 py-3 font-medium">
                                                    <span className="inline-flex items-center gap-2">
                                                        <span
                                                            className="inline-block w-2.5 h-2.5 rounded-full"
                                                            style={{ backgroundColor: categoryColorMap[summary.category] }}
                                                        />
                                                        {summary.category}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-right">{summary.riderCount}</td>
                                                {POWER_DURATION_KEYS.flatMap((key) => [
                                                    <td key={`${summary.category}-${key}-median`} className="px-3 py-3 text-right">
                                                        {formatConvertedPower(summary.median[key], powerUnit)}
                                                    </td>,
                                                    <td key={`${summary.category}-${key}-best`} className="px-3 py-3 text-right">
                                                        {formatConvertedPower(summary.best[key], powerUnit)}
                                                    </td>,
                                                ])}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <RiderTable
                            riders={sortedRiders}
                            sortKey={sortKey}
                            sortDir={sortDir}
                            powerUnit={powerUnit}
                            categoryColorMap={categoryColorMap}
                            onSort={toggleSort}
                        />
                    </div>
                )}
            </section>

            {selectedCategories.length > 0 && (
                <section>
                    <h3 className="text-lg font-semibold mb-3">Fælles sprintsegmenter</h3>
                    {sprintGroups.length === 0 ? (
                        <div className="p-6 bg-muted/20 rounded text-center text-muted-foreground">
                            Ingen sprintsegmenter blev kørt af mere end én division i dette løb.
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {sprintGroups.map((group) => {
                                const omitted = formatOmittedSprintNote(group.omittedCategories);
                                return (
                                    <div key={group.key} className="bg-card border border-border rounded-lg shadow-sm overflow-x-auto">
                                        <div className="px-4 py-3 border-b border-border font-medium">{group.label}</div>
                                        <table className="w-full text-left text-sm whitespace-nowrap">
                                            <thead className="bg-muted/40 text-muted-foreground">
                                                <tr>
                                                    <th className="px-4 py-3">Division</th>
                                                    <th className="px-4 py-3 text-right">Ryttere</th>
                                                    <th className="px-4 py-3 text-right">Median tid</th>
                                                    <th className="px-4 py-3 text-right">Bedste tid</th>
                                                    <th className="px-4 py-3 text-right">Median effekt</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {group.rows.map((row) => (
                                                    <tr key={`${group.key}-${row.category}`} className="border-t border-border">
                                                        <td className="px-4 py-3 font-medium">
                                                            <span className="inline-flex items-center gap-2">
                                                                <span
                                                                    className="inline-block w-2.5 h-2.5 rounded-full"
                                                                    style={{ backgroundColor: categoryColorMap[row.category] }}
                                                                />
                                                                {row.category}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3 text-right">{row.riderCount}</td>
                                                        <td className="px-4 py-3 text-right">{formatSeconds(row.medianTimeSec)}</td>
                                                        <td className="px-4 py-3 text-right">{formatSeconds(row.bestTimeSec)}</td>
                                                        <td className="px-4 py-3 text-right">{formatConvertedPower(row.medianPower, powerUnit)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                        {omitted && (
                                            <p className="px-4 py-3 text-sm text-muted-foreground border-t border-border">{omitted}</p>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </section>
            )}
        </div>
    );
}

function RiderTable({
    riders,
    sortKey,
    sortDir,
    powerUnit,
    categoryColorMap,
    onSort,
}: {
    riders: DivisionPowerRiderRow[];
    sortKey: SortKey;
    sortDir: 'asc' | 'desc';
    powerUnit: PowerUnit;
    categoryColorMap: Record<string, string>;
    onSort: (key: SortKey) => void;
}) {
    const header = (key: SortKey, label: string, align: 'left' | 'right') => {
        const active = sortKey === key;
        return (
            <th className={`px-4 py-3 ${align === 'right' ? 'text-right' : ''}`} aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <button
                    type="button"
                    onClick={() => onSort(key)}
                    className={`inline-flex items-center gap-1 font-medium ${align === 'right' ? 'w-full justify-end' : ''}`}
                >
                    {label}
                    <span className="text-[10px] text-muted-foreground">{active ? (sortDir === 'asc' ? '↑' : '↓') : ''}</span>
                </button>
            </th>
        );
    };

    return (
        <div>
            <h3 className="text-lg font-semibold mb-3">Ryttere</h3>
            <div className="bg-card border border-border rounded-lg shadow-sm overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-muted/40 text-muted-foreground">
                        <tr>
                            {header('name', 'Rytter', 'left')}
                            {header('category', 'Division', 'left')}
                            {POWER_DURATION_KEYS.map((key) => header(key, POWER_DURATION_LABELS[key], 'right'))}
                        </tr>
                    </thead>
                    <tbody>
                        {riders.map((rider) => (
                            <tr
                                key={`${rider.category}-${rider.zwiftId}`}
                                className={`border-t border-border ${rider.isMe ? 'bg-primary/10 font-semibold' : ''}`}
                            >
                                <td className="px-4 py-3">
                                    {rider.isMe ? `Mig (${rider.name})` : rider.name}
                                </td>
                                <td className="px-4 py-3">
                                    <span className="inline-flex items-center gap-2">
                                        <span
                                            className="inline-block w-2.5 h-2.5 rounded-full"
                                            style={{ backgroundColor: categoryColorMap[rider.category] }}
                                        />
                                        {rider.category}
                                    </span>
                                </td>
                                {POWER_DURATION_KEYS.map((key) => (
                                    <td key={key} className="px-4 py-3 text-right">
                                        {formatConvertedPower(rider.values[key], powerUnit)}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
