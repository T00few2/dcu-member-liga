'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Route, Segment, SelectedSegment } from '@/types/admin';
import { getRouteHelpers, calculateRouteTotals, fetchSegments } from '@/hooks/useLeagueData';
import { useRouteTimeEstimatesQuery, useLeagueSettingsQuery } from '@/hooks/queries';
import { getZwiftInsiderUrl } from '@/lib/api';
import { estimateMinutesPerLap, estimateTotalMinutes, solveLapsForTimeSpan, formatMinutes } from '@/lib/timeEstimate';
import SegmentPicker, { CollapsibleSegmentPicker } from './SegmentPicker';

interface RoutePlanningTabProps {
    routes: Route[];
}

type Category = 'A' | 'B' | 'C' | 'D';
type PlanningMode = 'laps' | 'time';
const CATEGORIES: Category[] = ['A', 'B', 'C', 'D'];
const DEFAULT_WKG: Record<Category, number> = { A: 4.2, B: 3.8, C: 3.4, D: 3.0 };
const DEFAULT_LAPS: Record<Category, number> = { A: 1, B: 1, C: 1, D: 1 };
const EMPTY_SPRINTS: Record<Category, SelectedSegment[]> = { A: [], B: [], C: [], D: [] };
const sum = (vals: number[]) => vals.reduce((acc, n) => acc + n, 0);

export default function RoutePlanningTab({ routes }: RoutePlanningTabProps) {
    const [selectedMap, setSelectedMap] = useState('');
    const [selectedRouteId, setSelectedRouteId] = useState('');
    const [laps, setLaps] = useState<Record<Category, number>>(DEFAULT_LAPS);
    const [wkg, setWkg] = useState<Record<Category, number>>(DEFAULT_WKG);
    const [mode, setMode] = useState<PlanningMode>('laps');
    const [timeSpanHours, setTimeSpanHours] = useState({ min: 1, max: 1.5 });
    const [segments, setSegments] = useState<Segment[]>([]);
    const [selectedSprints, setSelectedSprints] = useState<Record<Category, SelectedSegment[]>>(EMPTY_SPRINTS);
    const [pointsPreviewRiders, setPointsPreviewRiders] = useState(30);

    const { maps, filteredRoutes, selectedRoute } = getRouteHelpers(routes, selectedMap, selectedRouteId);
    const timeEstimatesQuery = useRouteTimeEstimatesQuery(selectedRoute?.name ?? '');
    const timeData = timeEstimatesQuery.data;
    const timeUnavailable = !!timeData?.error || (timeEstimatesQuery.isSuccess && (timeData?.estimates.length ?? 0) === 0);
    const leagueSettingsQuery = useLeagueSettingsQuery();
    const leagueSettings = leagueSettingsQuery.data;

    const getCatLaps = (cat: Category): number => {
        if (mode === 'time' && timeData && selectedRoute) {
            const perLapMinutes = estimateMinutesPerLap(timeData.estimates, wkg[cat]);
            if (perLapMinutes != null) {
                const solved = solveLapsForTimeSpan(selectedRoute, perLapMinutes, timeSpanHours.min * 60, timeSpanHours.max * 60);
                if (solved) return solved.laps;
            }
        }
        return laps[cat];
    };

    const maxLapsForSegments = useMemo(
        () => Math.max(1, ...CATEGORIES.map(cat => getCatLaps(cat))),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- getCatLaps closes over these
        [mode, timeData, wkg, laps, timeSpanHours, selectedRoute],
    );

    useEffect(() => {
        setSelectedSprints(EMPTY_SPRINTS);
    }, [selectedRouteId]);

    useEffect(() => {
        let cancelled = false;
        if (!selectedRouteId) { setSegments([]); return; }
        fetchSegments(selectedRouteId, maxLapsForSegments).then(data => {
            if (!cancelled) setSegments(data);
        });
        return () => { cancelled = true; };
    }, [selectedRouteId, maxLapsForSegments]);

    const toggleSprint = (cat: Category, seg: Segment) => {
        const key = `${seg.id}_${seg.count}`;
        setSelectedSprints(prev => {
            const current = prev[cat] || [];
            const exists = current.some(s => s.key === key);
            const next = exists
                ? current.filter(s => s.key !== key)
                : [...current, { ...seg, key, type: 'sprint' as const }];
            return { ...prev, [cat]: next };
        });
    };

    const isSegmentSelectedForAll = (key: string) =>
        CATEGORIES.every(cat => (selectedSprints[cat] || []).some(s => s.key === key));

    const toggleDefaultSprint = (seg: Segment) => {
        const key = `${seg.id}_${seg.count}`;
        const turnOn = !isSegmentSelectedForAll(key);
        setSelectedSprints(prev => {
            const next = { ...prev };
            for (const cat of CATEGORIES) {
                const current = prev[cat] || [];
                const exists = current.some(s => s.key === key);
                if (turnOn && !exists) {
                    next[cat] = [...current, { ...seg, key, type: 'sprint' as const }];
                } else if (!turnOn && exists) {
                    next[cat] = current.filter(s => s.key !== key);
                }
            }
            return next;
        });
    };

    const defaultSelectedSprints: SelectedSegment[] = segments
        .filter(seg => isSegmentSelectedForAll(`${seg.id}_${seg.count}`))
        .map(seg => ({ ...seg, key: `${seg.id}_${seg.count}`, type: 'sprint' as const }));

    return (
        <div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-1">Select Map</label>
                    <select
                        value={selectedMap}
                        onChange={e => { setSelectedMap(e.target.value); setSelectedRouteId(''); }}
                        className="w-full p-2 border border-input rounded bg-background text-foreground"
                    >
                        <option value="">-- Choose a Map --</option>
                        {maps.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                </div>
                <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-muted-foreground mb-1">Select Route</label>
                    <select
                        value={selectedRouteId}
                        onChange={e => setSelectedRouteId(e.target.value)}
                        className="w-full p-2 border border-input rounded bg-background text-foreground"
                        disabled={!selectedMap}
                    >
                        <option value="">{selectedMap ? '-- Choose a Route --' : '-- Select Map First --'}</option>
                        {filteredRoutes.map(r => (
                            <option key={r.id} value={r.id}>
                                {r.name} ({r.distance.toFixed(1)}km, {r.elevation}m)
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {selectedRoute && (
                <>
                    <div className="mb-6">
                        <label className="block text-sm font-medium text-muted-foreground mb-1">
                            Default Sprint Segments (applies to all categories)
                        </label>
                        <p className="text-xs text-muted-foreground mb-2">
                            Selecting a segment here adds it to every category below; you can still fine-tune each category&apos;s sprints individually.
                        </p>
                        <SegmentPicker
                            segments={segments}
                            selectedSprints={defaultSelectedSprints}
                            onToggle={toggleDefaultSprint}
                            segmentType="sprint"
                            maxLaps={maxLapsForSegments}
                            compact
                        />
                    </div>

                    <div className="mb-6 text-sm text-muted-foreground flex items-center gap-2">
                        <a
                            href={getZwiftInsiderUrl(selectedRoute.name)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                        >
                            View {selectedRoute.name} on ZwiftInsider (ZI ↗)
                        </a>
                        {timeEstimatesQuery.isLoading && <span>Loading time estimates...</span>}
                        {timeData?.rating != null && <span>ZI Rating: {timeData.rating}/100</span>}
                    </div>

                    {timeData && timeData.estimates.length > 0 && (
                        <p className="mb-6 text-sm text-muted-foreground">
                            ZwiftInsider reference laps: {timeData.estimates
                                .slice()
                                .sort((a, b) => b.wkg - a.wkg)
                                .map(e => `${e.wkg} W/kg: ${e.minutes}min`)
                                .join(' · ')}
                        </p>
                    )}
                    {timeUnavailable && (
                        <p className="mb-6 text-sm text-destructive">
                            Time estimates unavailable for this route.
                        </p>
                    )}

                    <div className="mb-6 flex flex-wrap items-end gap-4">
                        <div>
                            <span className="block text-sm font-medium text-muted-foreground mb-1">Planning Mode</span>
                            <div className="inline-flex rounded border border-input overflow-hidden">
                                <button
                                    type="button"
                                    onClick={() => setMode('laps')}
                                    className={`px-3 py-1 text-sm ${mode === 'laps' ? 'bg-primary text-primary-foreground' : 'bg-background text-foreground'}`}
                                >
                                    Manual Laps
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setMode('time')}
                                    className={`px-3 py-1 text-sm border-l border-input ${mode === 'time' ? 'bg-primary text-primary-foreground' : 'bg-background text-foreground'}`}
                                >
                                    Target Time
                                </button>
                            </div>
                        </div>

                        {mode === 'time' && (
                            <>
                                <div>
                                    <label htmlFor="route-planning-min-hours" className="block text-xs text-muted-foreground mb-1">Min Hours</label>
                                    <input
                                        id="route-planning-min-hours"
                                        type="number"
                                        step="0.25"
                                        min="0"
                                        value={timeSpanHours.min}
                                        onChange={e => setTimeSpanHours(prev => ({ ...prev, min: parseFloat(e.target.value) || 0 }))}
                                        className="w-28 p-1 border border-input rounded bg-background text-foreground"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="route-planning-max-hours" className="block text-xs text-muted-foreground mb-1">Max Hours</label>
                                    <input
                                        id="route-planning-max-hours"
                                        type="number"
                                        step="0.25"
                                        min="0"
                                        value={timeSpanHours.max}
                                        onChange={e => setTimeSpanHours(prev => ({ ...prev, max: parseFloat(e.target.value) || 0 }))}
                                        className="w-28 p-1 border border-input rounded bg-background text-foreground"
                                    />
                                </div>
                                {timeUnavailable && (
                                    <p className="text-sm text-destructive">
                                        Can&apos;t solve for laps without time estimates for this route.
                                    </p>
                                )}
                            </>
                        )}
                    </div>

                    <div className="mb-6 flex items-center gap-2">
                        <label htmlFor="route-planning-preview-riders" className="text-sm text-muted-foreground font-medium">
                            Riders per category (points preview):
                        </label>
                        <input
                            id="route-planning-preview-riders"
                            type="number"
                            min="1"
                            value={pointsPreviewRiders}
                            onChange={e => setPointsPreviewRiders(Math.max(1, parseInt(e.target.value) || 1))}
                            className="w-24 p-1.5 border border-input rounded bg-background text-foreground text-sm"
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        {CATEGORIES.map(cat => {
                            const perLapMinutes = timeData ? estimateMinutesPerLap(timeData.estimates, wkg[cat]) : null;

                            let lapsForCat = laps[cat];
                            let solved: ReturnType<typeof solveLapsForTimeSpan> = null;
                            if (mode === 'time' && perLapMinutes != null) {
                                solved = solveLapsForTimeSpan(
                                    selectedRoute,
                                    perLapMinutes,
                                    timeSpanHours.min * 60,
                                    timeSpanHours.max * 60,
                                );
                                if (solved) lapsForCat = solved.laps;
                            }

                            const totals = calculateRouteTotals(selectedRoute, lapsForCat);
                            const totalMinutes = perLapMinutes != null
                                ? estimateTotalMinutes(selectedRoute, perLapMinutes, lapsForCat)
                                : null;

                            const catSegments = segments.filter(s => (s.lap || 1) <= lapsForCat);
                            const validKeys = new Set(catSegments.map(s => `${s.id}_${s.count}`));
                            const catSprints = selectedSprints[cat] || [];
                            const sprintSegmentCount = catSprints.filter(s => validKeys.has(s.key)).length;

                            const riders = Math.max(1, pointsPreviewRiders);
                            const finishTotal = sum((leagueSettings?.finishPoints || []).slice(0, riders));
                            const sprintPerSegment = sum((leagueSettings?.sprintPoints || []).slice(0, riders));
                            const sprintTotal = sprintPerSegment * sprintSegmentCount;
                            const combinedTotal = finishTotal + sprintTotal;
                            const finishPct = combinedTotal > 0 ? (finishTotal / combinedTotal) * 100 : 0;
                            const sprintPct = combinedTotal > 0 ? (sprintTotal / combinedTotal) * 100 : 0;
                            const pieHoverText = combinedTotal > 0
                                ? `Finish: ${finishPct.toFixed(1)}% (${finishTotal} pts)\nSprint: ${sprintPct.toFixed(1)}% (${sprintTotal} pts)\nTotal: ${combinedTotal} pts`
                                : 'No points to preview (check points settings and sprint segments)';

                            return (
                                <div key={cat} className="border border-border rounded p-4 space-y-3">
                                    <h3 className="font-semibold text-lg">Category {cat}</h3>

                                    <div>
                                        <label className="block text-xs text-muted-foreground mb-1">Laps</label>
                                        {mode === 'laps' ? (
                                            <input
                                                type="number"
                                                min="1"
                                                value={laps[cat]}
                                                onChange={e => setLaps(prev => ({ ...prev, [cat]: parseInt(e.target.value) || 1 }))}
                                                className="w-full p-1 border border-input rounded bg-background text-foreground"
                                            />
                                        ) : (
                                            <div className="w-full p-1">
                                                <span className="font-mono font-medium">{solved ? solved.laps : '—'}</span>
                                                {solved && !solved.withinSpan && (
                                                    <span className="ml-2 text-xs text-destructive">outside target span</span>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    <div>
                                        <label className="block text-xs text-muted-foreground mb-1">Target W/kg</label>
                                        <input
                                            type="number"
                                            step="0.1"
                                            min="0"
                                            value={wkg[cat]}
                                            onChange={e => setWkg(prev => ({ ...prev, [cat]: parseFloat(e.target.value) || 0 }))}
                                            className="w-full p-1 border border-input rounded bg-background text-foreground"
                                        />
                                    </div>

                                    <div>
                                        <span className="block text-xs text-muted-foreground">Total Distance</span>
                                        <span className="font-mono font-medium">{totals.totalDistance.toFixed(1)} km</span>
                                    </div>
                                    <div>
                                        <span className="block text-xs text-muted-foreground">Total Elevation</span>
                                        <span className="font-mono font-medium">{totals.totalElevation} m</span>
                                    </div>
                                    <div>
                                        <span className="block text-xs text-muted-foreground">Est. Time</span>
                                        <span className="font-mono font-medium">
                                            {totalMinutes != null ? formatMinutes(totalMinutes) : '—'}
                                        </span>
                                    </div>

                                    <div>
                                        <label className="block text-xs text-muted-foreground mb-1">Sprints</label>
                                        <CollapsibleSegmentPicker
                                            segments={catSegments}
                                            selectedSprints={catSprints}
                                            onToggle={seg => toggleSprint(cat, seg)}
                                            segmentType="sprint"
                                            maxLaps={lapsForCat}
                                        />
                                    </div>

                                    <div>
                                        <span className="block text-xs text-muted-foreground mb-1">Points Preview</span>
                                        <div className="flex items-center gap-3">
                                            <div
                                                className="w-12 h-12 rounded-full border border-border shrink-0"
                                                style={{
                                                    background: combinedTotal > 0
                                                        ? `conic-gradient(#2563eb 0 ${finishPct}%, #16a34a ${finishPct}% 100%)`
                                                        : 'var(--muted)',
                                                }}
                                                aria-label="Points split pie chart"
                                                title={pieHoverText}
                                            />
                                            <div className="text-xs leading-5">
                                                <div className="text-muted-foreground">
                                                    Finish: <span className="font-medium text-foreground">{finishTotal}</span>
                                                </div>
                                                <div className="text-muted-foreground">
                                                    Sprint: <span className="font-medium text-foreground">{sprintTotal}</span>{' '}
                                                    <span className="text-[11px]">({sprintSegmentCount} segment{sprintSegmentCount === 1 ? '' : 's'})</span>
                                                </div>
                                                <div className="text-muted-foreground">
                                                    Total: <span className="font-medium text-foreground">{combinedTotal}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
}
