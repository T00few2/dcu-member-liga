'use client';

import { User } from 'firebase/auth';
import { useState } from 'react';
import type { Route, Segment, RaceFormState, EventConfig, CategoryConfig, LoadingStatus, ProfileSegment } from '@/types/admin';
import { getRouteHelpers } from '@/hooks/useLeagueData';
import SegmentPicker from './SegmentPicker';
import SingleModeConfig from './SingleModeConfig';
import MultiModeConfig from './MultiModeConfig';

interface RaceFormProps {
    user: User | null;
    routes: Route[];
    segments: Segment[];
    formState: RaceFormState;
    status: LoadingStatus;
    onFieldChange: <K extends keyof RaceFormState>(field: K, value: RaceFormState[K]) => void;
    onToggleSegment: (seg: Segment) => void;
    onAddEventConfig: () => void;
    onRemoveEventConfig: (index: number) => void;
    onUpdateEventConfig: (index: number, field: keyof EventConfig, value: EventConfig[keyof EventConfig]) => void;
    onToggleConfigSprint: (configIndex: number, seg: Segment) => void;
    onAddSingleModeCategory: () => void;
    onRemoveSingleModeCategory: (index: number) => void;
    onUpdateSingleModeCategory: (index: number, field: keyof CategoryConfig, value: CategoryConfig[keyof CategoryConfig]) => void;
    onToggleSingleModeCategorySprint: (configIndex: number, seg: Segment) => void;
    onUpdateProfileSegment: (index: number, patch: Partial<ProfileSegment>) => void;
    onAddProfileSegment: () => void;
    onRemoveProfileSegment: (index: number) => void;
    onCancel: () => void;
    onSave: (e: React.FormEvent) => void;
}

export default function RaceForm({
    user,
    routes,
    segments,
    formState,
    status,
    onFieldChange,
    onToggleSegment,
    onAddEventConfig,
    onRemoveEventConfig,
    onUpdateEventConfig,
    onToggleConfigSprint,
    onAddSingleModeCategory,
    onRemoveSingleModeCategory,
    onUpdateSingleModeCategory,
    onToggleSingleModeCategorySprint,
    onUpdateProfileSegment,
    onAddProfileSegment,
    onRemoveProfileSegment,
    onCancel,
    onSave,
}: RaceFormProps) {
    const [loadingProfileSegments, setLoadingProfileSegments] = useState(false);
    const { maps, filteredRoutes, selectedRoute } = getRouteHelpers(
        routes,
        formState.selectedMap,
        formState.selectedRouteId
    );

    const isEditing = formState.editingRaceId !== null;

    const segmentsByLap = segments.reduce((acc, seg) => {
        const lap = seg.lap || 1;
        if (!acc[lap]) acc[lap] = [];
        acc[lap].push(seg);
        return acc;
    }, {} as Record<number, Segment[]>);

    const inferDirection = (rawDirection: unknown, name: unknown): 'forward' | 'reverse' => {
        if (rawDirection === 'reverse') return 'reverse';
        const n = String(name || '').toLowerCase();
        if (n.includes(' rev') || n.includes('reverse')) return 'reverse';
        return 'forward';
    };

    const normalizeNameForMatch = (name: unknown): string =>
        String(name || '')
            .toLowerCase()
            .replace(/\s+\(.*\)\s*$/g, '')
            .replace(/\s+(reverse|rev\.?)$/g, '')
            .replace(/\s+/g, ' ')
            .trim();

    const inferTypeFromName = (name: unknown): ProfileSegment['type'] => {
        const n = String(name || '').toLowerCase();
        if (n.includes('sprint') || n.includes('prime')) return 'sprint';
        if (n.includes('kom') || n.includes('climb')) return 'climb';
        return 'segment';
    };

    const collectRouteSegments = (): Segment[] => {
        const rows: Segment[] = [...(segments || [])];
        const seen = new Set<string>();
        const unique: Segment[] = [];
        for (const s of rows) {
            const k = `${s.id || s.name}_${s.count || 1}_${String(s.direction || '').toLowerCase()}`;
            if (seen.has(k)) continue;
            seen.add(k);
            unique.push(s);
        }
        return unique;
    };

    const handleAutoFillProfileSegments = async () => {
        if (!selectedRoute) return;
        setLoadingProfileSegments(true);
        try {
            const configured = collectRouteSegments();
            if (configured.length === 0) {
                alert('No route segments are loaded. Select route/laps first.');
                return;
            }
            const params = new URLSearchParams({
                world: selectedRoute.map,
                route: selectedRoute.name,
                laps: String(formState.laps || 1),
            });
            const res = await fetch(`/api/route-elevation?${params}`, { cache: 'no-store' });
            if (!res.ok) throw new Error(`Failed with ${res.status}`);
            const json = await res.json();

            const routeSegments: any[] = Array.isArray(json?.segments) ? json.segments : [];
            const occurrenceCounters = new Map<string, number>();
            const routeByOccurrenceKey = new Map<string, any>();
            routeSegments.forEach((seg) => {
                const base = `${normalizeNameForMatch(seg?.name)}::${inferDirection(seg?.direction, seg?.name)}`;
                const occ = (occurrenceCounters.get(base) || 0) + 1;
                occurrenceCounters.set(base, occ);
                routeByOccurrenceKey.set(`${base}::${occ}`, seg);
            });

            const mapped: ProfileSegment[] = configured.map((seg) => {
                const direction = inferDirection(seg.direction, seg.name);
                const occ = Number.isFinite(seg.count) && seg.count > 0 ? seg.count : 1;
                const key = `${normalizeNameForMatch(seg.name)}::${direction}::${occ}`;
                const hit = routeByOccurrenceKey.get(key);
                return {
                    name: seg.name || 'Segment',
                    type: hit?.type === 'sprint' || hit?.type === 'climb' || hit?.type === 'segment'
                        ? hit.type
                        : inferTypeFromName(seg.name),
                    fromKm: Number(hit?.from) || 0,
                    toKm: Number(hit?.to) || 0,
                    direction,
                };
            });
            onFieldChange('profileSegments', mapped);
        } catch (e) {
            alert('Could not auto-fill profile segments');
        } finally {
            setLoadingProfileSegments(false);
        }
    };

    return (
        <div className="bg-card p-6 rounded-lg shadow mb-8 border border-border">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold text-card-foreground">
                    {isEditing ? 'Edit Scheduled Race' : 'Schedule New Race'}
                </h2>
                {isEditing && (
                    <button onClick={onCancel} className="text-sm text-muted-foreground hover:text-foreground">
                        Cancel Edit
                    </button>
                )}
            </div>

            <form onSubmit={onSave} className="space-y-6">
                {/* Basic Info */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div>
                        <label className="block text-sm font-medium text-muted-foreground mb-1">Race Name</label>
                        <input
                            type="text"
                            required
                            value={formState.name}
                            onChange={e => onFieldChange('name', e.target.value)}
                            className="w-full p-2 border border-input rounded bg-background text-foreground"
                            placeholder="e.g. League Opener"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-muted-foreground mb-1">Date & Time</label>
                        <input
                            type="datetime-local"
                            required
                            value={formState.date}
                            onChange={e => onFieldChange('date', e.target.value)}
                            className="w-full p-2 border border-input rounded bg-background text-foreground"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-muted-foreground mb-1">Race Type</label>
                        <select
                            value={formState.raceType}
                            onChange={e => onFieldChange('raceType', e.target.value as 'scratch' | 'points' | 'time-trial')}
                            className="w-full p-2 border border-input rounded bg-background text-foreground"
                        >
                            <option value="scratch">Scratch Race</option>
                            <option value="points">Points Race</option>
                            <option value="time-trial">Time Trial</option>
                        </select>
                    </div>
                </div>

                {/* Route Selection */}
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

                {/* Route Details & Configuration */}
                {selectedRoute && (
                    <div className="p-4 bg-muted/50 rounded-lg border border-border">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-4">
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

                        {/* Event Mode */}
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-muted-foreground mb-2">
                                Result Source Configuration
                            </label>
                            <div className="flex gap-4 mb-4">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="eventMode"
                                        checked={formState.eventMode === 'single'}
                                        onChange={() => onFieldChange('eventMode', 'single')}
                                        className="text-primary focus:ring-primary"
                                    />
                                    <span className="text-sm">Standard (Single Zwift Event)</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="eventMode"
                                        checked={formState.eventMode === 'multi'}
                                        onChange={() => onFieldChange('eventMode', 'multi')}
                                        className="text-primary focus:ring-primary"
                                    />
                                    <span className="text-sm">Multi-Category (Multiple IDs)</span>
                                </label>
                            </div>

                            {formState.eventMode === 'single' && (
                                <SingleModeConfig
                                    formState={formState}
                                    segments={segments}
                                    segmentsByLap={segmentsByLap}
                                    onFieldChange={onFieldChange}
                                    onToggleSegment={onToggleSegment}
                                    onAddSingleModeCategory={onAddSingleModeCategory}
                                    onRemoveSingleModeCategory={onRemoveSingleModeCategory}
                                    onUpdateSingleModeCategory={onUpdateSingleModeCategory}
                                    onToggleSingleModeCategorySprint={onToggleSingleModeCategorySprint}
                                />
                            )}

                            {formState.eventMode === 'multi' && (
                                <MultiModeConfig
                                    formState={formState}
                                    segments={segments}
                                    segmentsByLap={segmentsByLap}
                                    onAddEventConfig={onAddEventConfig}
                                    onRemoveEventConfig={onRemoveEventConfig}
                                    onUpdateEventConfig={onUpdateEventConfig}
                                    onToggleConfigSprint={onToggleConfigSprint}
                                />
                            )}

                            <p className="text-xs text-muted-foreground mt-2">
                                {formState.eventMode === 'single'
                                    ? 'Used to fetch race results automatically from a single event.'
                                    : 'Map multiple Zwift Events to specific categories (e.g. Event 101 -> Elite Men, Event 102 -> H40).'}
                            </p>
                        </div>

                        {/* Global Sprint Selection (single mode, no per-category config) */}
                        {formState.eventMode === 'single' && formState.singleModeCategories.length === 0 && (
                            <div className="border-t border-border pt-4">
                                <div className="mb-3">
                                    <label className="block font-medium text-card-foreground mb-1">Segments Used For</label>
                                    <select
                                        value={formState.segmentType}
                                        onChange={e => onFieldChange('segmentType', e.target.value as 'sprint' | 'split')}
                                        className="w-full sm:w-64 p-2 border border-input rounded bg-background text-foreground text-sm"
                                    >
                                        <option value="sprint">Sprint Points</option>
                                        <option value="split">Time Trial Splits</option>
                                    </select>
                                </div>
                                <label className="block font-medium text-card-foreground mb-3">
                                    {formState.segmentType === 'split' ? 'Split Segments' : 'Sprint Segments (Scoring)'}
                                </label>
                                <SegmentPicker
                                    segments={segments}
                                    selectedSprints={formState.selectedSprints}
                                    onToggle={onToggleSegment}
                                    segmentType={formState.segmentType}
                                />
                            </div>
                        )}

                        {/* Profile Segment Positions (curated for race card route profile) */}
                        <div className="border-t border-border pt-4 mt-4">
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                                <label className="block font-medium text-card-foreground">
                                    Route Profile Segments (manual override)
                                </label>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={handleAutoFillProfileSegments}
                                        disabled={loadingProfileSegments}
                                        className="px-3 py-1.5 text-xs rounded bg-secondary text-secondary-foreground hover:opacity-90"
                                    >
                                        {loadingProfileSegments ? 'Loading...' : 'Fill all route segments + route data'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={onAddProfileSegment}
                                        className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:opacity-90"
                                    >
                                        + Add segment
                                    </button>
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground mb-3">
                                These values are used directly for segment boxes on race cards.
                            </p>
                            <div className="space-y-2">
                                {formState.profileSegments.length === 0 && (
                                    <div className="text-xs text-muted-foreground border border-dashed border-border rounded p-3">
                                        No curated profile segments yet.
                                    </div>
                                )}
                                {formState.profileSegments.map((seg, i) => (
                                    <div key={i} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end border border-border rounded p-2">
                                        <div className="md:col-span-4">
                                            <label className="block text-[11px] text-muted-foreground mb-1">Name</label>
                                            <input
                                                type="text"
                                                value={seg.name}
                                                onChange={(e) => onUpdateProfileSegment(i, { name: e.target.value })}
                                                className="w-full p-1.5 border border-input rounded bg-background text-foreground text-sm"
                                            />
                                        </div>
                                        <div className="md:col-span-2">
                                            <label className="block text-[11px] text-muted-foreground mb-1">Type</label>
                                            <select
                                                value={seg.type}
                                                onChange={(e) => onUpdateProfileSegment(i, { type: e.target.value as ProfileSegment['type'] })}
                                                className="w-full p-1.5 border border-input rounded bg-background text-foreground text-sm"
                                            >
                                                <option value="climb">Climb</option>
                                                <option value="sprint">Sprint</option>
                                                <option value="segment">Segment</option>
                                            </select>
                                        </div>
                                        <div className="md:col-span-2">
                                            <label className="block text-[11px] text-muted-foreground mb-1">From km</label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={seg.fromKm}
                                                onChange={(e) => onUpdateProfileSegment(i, { fromKm: Number(e.target.value) || 0 })}
                                                className="w-full p-1.5 border border-input rounded bg-background text-foreground text-sm"
                                            />
                                        </div>
                                        <div className="md:col-span-2">
                                            <label className="block text-[11px] text-muted-foreground mb-1">To km</label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={seg.toKm}
                                                onChange={(e) => onUpdateProfileSegment(i, { toKm: Number(e.target.value) || 0 })}
                                                className="w-full p-1.5 border border-input rounded bg-background text-foreground text-sm"
                                            />
                                        </div>
                                        <div className="md:col-span-1">
                                            <label className="block text-[11px] text-muted-foreground mb-1">Dir</label>
                                            <select
                                                value={seg.direction || 'forward'}
                                                onChange={(e) => onUpdateProfileSegment(i, { direction: e.target.value as ProfileSegment['direction'] })}
                                                className="w-full p-1.5 border border-input rounded bg-background text-foreground text-sm"
                                            >
                                                <option value="forward">F</option>
                                                <option value="reverse">R</option>
                                            </select>
                                        </div>
                                        <div className="md:col-span-1">
                                            <button
                                                type="button"
                                                onClick={() => onRemoveProfileSegment(i)}
                                                className="w-full p-1.5 text-xs rounded bg-destructive text-destructive-foreground hover:opacity-90"
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* Submit */}
                <div className="flex gap-3 pt-2">
                    <button
                        type="submit"
                        disabled={status === 'saving'}
                        className="bg-primary text-primary-foreground px-6 py-2 rounded hover:opacity-90 font-medium shadow-sm"
                    >
                        {status === 'saving' ? 'Saving...' : (isEditing ? 'Update Race' : 'Create Race')}
                    </button>
                    {isEditing && (
                        <button
                            type="button"
                            onClick={onCancel}
                            className="bg-secondary text-secondary-foreground px-4 py-2 rounded hover:opacity-90"
                        >
                            Cancel
                        </button>
                    )}
                </div>
            </form>
        </div>
    );
}
