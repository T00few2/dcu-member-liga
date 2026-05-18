'use client';

import type { Route } from '@/types/admin';
import { getRouteHelpers } from '@/hooks/useLeagueData';
import { useRaceFormContext } from '@/lib/race-form-context';

interface RaceRouteSelectorProps {
    routes: Route[];
}

export default function RaceRouteSelector({ routes }: RaceRouteSelectorProps) {
    const { formState, onFieldChange } = useRaceFormContext();

    const { maps, filteredRoutes, selectedRoute } = getRouteHelpers(
        routes,
        formState.selectedMap,
        formState.selectedRouteId
    );

    return (
        <>
            {/* Map + Route dropdowns */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-1">Select Map</label>
                    <select
                        value={formState.selectedMap}
                        onChange={e => {
                            onFieldChange('selectedMap', e.target.value);
                            onFieldChange('selectedRouteId', '');
                        }}
                        className="w-full p-2 border border-input rounded bg-background text-foreground"
                        required
                    >
                        <option value="">-- Choose a Map --</option>
                        {maps.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                </div>
                <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-muted-foreground mb-1">Select Route</label>
                    <select
                        value={formState.selectedRouteId}
                        onChange={e => onFieldChange('selectedRouteId', e.target.value)}
                        className="w-full p-2 border border-input rounded bg-background text-foreground"
                        required
                        disabled={!formState.selectedMap}
                    >
                        <option value="">
                            {formState.selectedMap ? '-- Choose a Route --' : '-- Select Map First --'}
                        </option>
                        {filteredRoutes.map(r => (
                            <option key={r.id} value={r.id}>
                                {r.name} ({r.distance.toFixed(1)}km, {r.elevation}m)
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Laps + Distance + Elevation */}
            {selectedRoute && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div>
                        <label className="block font-medium text-muted-foreground mb-1">Laps</label>
                        <input
                            type="number"
                            min="1"
                            value={formState.laps}
                            onChange={e => onFieldChange('laps', parseInt(e.target.value) || 1)}
                            className="w-20 p-1 border border-input rounded bg-background text-foreground"
                        />
                    </div>
                    <div className="text-card-foreground flex flex-col justify-end">
                        <span className="text-sm text-muted-foreground">Total Distance</span>
                        <span className="font-mono font-medium">
                            {((selectedRoute.distance * formState.laps) + selectedRoute.leadinDistance).toFixed(1)} km
                        </span>
                    </div>
                    <div className="text-card-foreground flex flex-col justify-end">
                        <span className="text-sm text-muted-foreground">Total Elevation</span>
                        <span className="font-mono font-medium">
                            {Math.round(selectedRoute.elevation * formState.laps + selectedRoute.leadinElevation)} m
                        </span>
                    </div>
                </div>
            )}
        </>
    );
}
