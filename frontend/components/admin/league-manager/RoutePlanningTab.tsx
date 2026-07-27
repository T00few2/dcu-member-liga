'use client';

import { useState } from 'react';
import type { Route } from '@/types/admin';
import { getRouteHelpers, calculateRouteTotals } from '@/hooks/useLeagueData';
import { useRouteTimeEstimatesQuery } from '@/hooks/queries';
import { getZwiftInsiderUrl } from '@/lib/api';
import { estimateMinutesPerLap, formatMinutes } from '@/lib/timeEstimate';

interface RoutePlanningTabProps {
    routes: Route[];
}

type Category = 'A' | 'B' | 'C' | 'D';
const CATEGORIES: Category[] = ['A', 'B', 'C', 'D'];
const DEFAULT_WKG: Record<Category, number> = { A: 4.0, B: 3.2, C: 2.5, D: 2.0 };
const DEFAULT_LAPS: Record<Category, number> = { A: 1, B: 1, C: 1, D: 1 };

export default function RoutePlanningTab({ routes }: RoutePlanningTabProps) {
    const [selectedMap, setSelectedMap] = useState('');
    const [selectedRouteId, setSelectedRouteId] = useState('');
    const [laps, setLaps] = useState<Record<Category, number>>(DEFAULT_LAPS);
    const [wkg, setWkg] = useState<Record<Category, number>>(DEFAULT_WKG);

    const { maps, filteredRoutes, selectedRoute } = getRouteHelpers(routes, selectedMap, selectedRouteId);
    const timeEstimatesQuery = useRouteTimeEstimatesQuery(selectedRoute?.name ?? '');
    const timeData = timeEstimatesQuery.data;
    const timeUnavailable = !!timeData?.error || (timeEstimatesQuery.isSuccess && (timeData?.estimates.length ?? 0) === 0);

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

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        {CATEGORIES.map(cat => {
                            const totals = calculateRouteTotals(selectedRoute, laps[cat]);
                            const perLapMinutes = timeData ? estimateMinutesPerLap(timeData.estimates, wkg[cat]) : null;
                            let totalMinutes: number | null = null;
                            if (perLapMinutes != null && selectedRoute.distance > 0) {
                                const speedKmPerMin = selectedRoute.distance / perLapMinutes;
                                const leadInMinutes = selectedRoute.leadinDistance / speedKmPerMin;
                                totalMinutes = perLapMinutes * laps[cat] + leadInMinutes;
                            }

                            return (
                                <div key={cat} className="border border-border rounded p-4 space-y-3">
                                    <h3 className="font-semibold text-lg">Category {cat}</h3>

                                    <div>
                                        <label className="block text-xs text-muted-foreground mb-1">Laps</label>
                                        <input
                                            type="number"
                                            min="1"
                                            value={laps[cat]}
                                            onChange={e => setLaps(prev => ({ ...prev, [cat]: parseInt(e.target.value) || 1 }))}
                                            className="w-full p-1 border border-input rounded bg-background text-foreground"
                                        />
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
                                </div>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
}
