'use client';

import { User } from 'firebase/auth';
import { useEffect, useState } from 'react';
import type { Route, Segment, RaceFormState, EventConfig, CategoryConfig, RaceGroup, RaceGroupCategoryConfig, LoadingStatus } from '@/types/admin';
import { getRouteHelpers } from '@/hooks/useLeagueData';
import { API_URL } from '@/lib/api';
import { RaceFormProvider } from '@/lib/race-form-context';
import SingleModeConfig from './SingleModeConfig';
import MultiModeConfig from './MultiModeConfig';
import GroupedModeConfig from './GroupedModeConfig';
import RaceBasicFields from './race-form/RaceBasicFields';
import RaceRouteSelector from './race-form/RaceRouteSelector';

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
    onAddRaceGroup: () => void;
    onRemoveRaceGroup: (groupIndex: number) => void;
    onUpdateRaceGroup: (groupIndex: number, field: keyof RaceGroup, value: RaceGroup[keyof RaceGroup]) => void;
    onAddGroupCategory: (groupIndex: number) => void;
    onRemoveGroupCategory: (groupIndex: number, catIndex: number) => void;
    onUpdateGroupCategory: (groupIndex: number, catIndex: number, field: keyof RaceGroupCategoryConfig, value: RaceGroupCategoryConfig[keyof RaceGroupCategoryConfig]) => void;
    onToggleGroupCategorySprint: (groupIndex: number, catIndex: number, seg: Segment) => void;
    onToggleGroupSprint: (groupIndex: number, seg: Segment) => void;
    onCancel: () => void;
    onSave: (e: React.FormEvent) => void;
}

interface RouteProfileSegment {
    name: string;
    type: 'sprint' | 'climb' | 'segment';
    fromKm: string;
    toKm: string;
    direction: 'forward' | 'reverse';
}

function inferDirection(rawDirection: unknown, name: unknown): 'forward' | 'reverse' {
    if (rawDirection === 'reverse') return 'reverse';
    const n = String(name || '').toLowerCase();
    if (n.includes(' rev') || n.includes('reverse')) return 'reverse';
    return 'forward';
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
    onAddRaceGroup,
    onRemoveRaceGroup,
    onUpdateRaceGroup,
    onAddGroupCategory,
    onRemoveGroupCategory,
    onUpdateGroupCategory,
    onToggleGroupCategorySprint,
    onToggleGroupSprint,
    onCancel,
    onSave,
}: RaceFormProps) {
    const [loadingRouteProfile, setLoadingRouteProfile] = useState(false);
    const [savingRouteProfile, setSavingRouteProfile] = useState(false);
    const [routeProfileSegments, setRouteProfileSegments] = useState<RouteProfileSegment[]>([]);
    const [routeProfileLeadIn, setRouteProfileLeadIn] = useState<string>('');
    const [routeProfileSegmentId, setRouteProfileSegmentId] = useState<number | null>(null);
    const [routeProfileError, setRouteProfileError] = useState<string | null>(null);

    const { selectedRoute } = getRouteHelpers(
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

    // Build unique name→direction lookup from lap-1 segments for the autofill datalist
    const lap1SegmentOptions = Array.from(
        segments
            .filter(s => (s.lap ?? 1) === 1)
            .reduce((map, s) => {
                if (!map.has(s.name)) map.set(s.name, s.direction as 'forward' | 'reverse');
                return map;
            }, new Map<string, 'forward' | 'reverse'>())
            .entries()
    ).map(([name, direction]) => ({ name, direction }));

    const mapProfileSegments = (raw: unknown): RouteProfileSegment[] => {
        if (!Array.isArray(raw) || raw.length === 0) return [];
        return raw.map((seg: any) => ({
            name: String(seg?.name || 'Segment').trim() || 'Segment',
            type: seg?.type === 'sprint' || seg?.type === 'climb' || seg?.type === 'segment' ? seg.type : 'segment',
            fromKm: seg?.fromKm != null ? String(seg.fromKm) : (seg?.from != null ? String(seg.from) : ''),
            toKm: seg?.toKm != null ? String(seg.toKm) : (seg?.to != null ? String(seg.to) : ''),
            direction: inferDirection(seg?.direction, seg?.name),
        }));
    };

    const loadRouteProfileSegments = async (opts?: {
        signal?: AbortSignal;
        forceDefaults?: boolean;
    }) => {
        if (!selectedRoute) return;
        setLoadingRouteProfile(true);
        setRouteProfileError(null);
        try {
            // Resolve elevation_cache key + default segment placements (from/to km).
            const metaParams = new URLSearchParams({
                world: selectedRoute.map,
                route: selectedRoute.name,
            });
            const metaRes = await fetch(`/api/route-meta?${metaParams}`, {
                cache: 'no-store',
                signal: opts?.signal,
            });
            if (!metaRes.ok) {
                throw new Error(`Could not resolve route cache key (${metaRes.status})`);
            }
            const meta = await metaRes.json();
            const sid = Number(meta?.stravaSegmentId);
            if (!Number.isFinite(sid) || sid <= 0) {
                throw new Error('Could not resolve Strava segment ID for route');
            }
            const defaults = mapProfileSegments(meta?.defaultProfileSegments);

            // Load saved cache doc when available. A Strava/elevation 502 must not block
            // seeding profile segment from/to km from route metadata.
            let cache: Record<string, unknown> = {};
            let cacheWarning: string | null = null;
            try {
                const elevParams = new URLSearchParams({
                    world: selectedRoute.map,
                    route: selectedRoute.name,
                });
                const cacheRes = await fetch(`${API_URL}/route-elevation/${sid}?${elevParams}`, {
                    cache: 'no-store',
                    signal: opts?.signal,
                });
                if (cacheRes.ok) {
                    cache = await cacheRes.json();
                } else {
                    cacheWarning = `Elevation cache unavailable (${cacheRes.status}). Showing route segment defaults.`;
                }
            } catch {
                cacheWarning = 'Elevation cache unavailable. Showing route segment defaults.';
            }

            let mapped = opts?.forceDefaults ? [] : mapProfileSegments(cache?.profileSegments);
            let seededFromDefaults = false;

            // No saved profile segments → seed start/end km from Zwift route placements
            // (Strava-linked segments on the route). Strava streams alone are elevation only.
            if (mapped.length === 0) {
                mapped = defaults;
                seededFromDefaults = defaults.length > 0;
            }

            if (opts?.signal?.aborted) return;
            setRouteProfileSegmentId(sid);
            setRouteProfileSegments(mapped);
            setRouteProfileLeadIn(cache?.leadInDistance != null ? String(cache.leadInDistance) : '');
            const elevErr = typeof cache?.elevationFetchError === 'string' ? cache.elevationFetchError : null;
            if (cacheWarning) {
                setRouteProfileError(cacheWarning);
            } else if (elevErr && mapped.length > 0) {
                setRouteProfileError(`${elevErr}. Profile segments were still loaded from the route.`);
            } else if (elevErr) {
                setRouteProfileError(elevErr);
            }

            // Persist first-time seed so race cards use the same profileSegments.
            if (seededFromDefaults && user && mapped.length > 0) {
                const token = await user.getIdToken();
                const payload = mapped.map((seg) => ({
                    name: (seg.name || '').trim() || 'Segment',
                    type: seg.type,
                    fromKm: Math.min(Number(seg.fromKm) || 0, Number(seg.toKm) || 0),
                    toKm: Math.max(Number(seg.fromKm) || 0, Number(seg.toKm) || 0),
                    direction: seg.direction === 'reverse' ? 'reverse' : 'forward',
                }));
                const saveRes = await fetch(`${API_URL}/route-elevation/${sid}/profile-segments`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        profileSegments: payload,
                        world: selectedRoute.map,
                        route: selectedRoute.name,
                    }),
                    signal: opts?.signal,
                });
                const saveJson = await saveRes.json().catch(() => ({}));
                if (!saveRes.ok) {
                    setRouteProfileError(
                        saveJson?.message
                        || 'Loaded defaults, but failed to save them to elevation_cache. Click Save to retry.',
                    );
                } else if (saveJson?.elevationReady === false) {
                    setRouteProfileError(
                        saveJson?.elevationFetchError
                            ? `Profile segments saved, but race-card elevation chart is not ready: ${saveJson.elevationFetchError}`
                            : 'Profile segments saved, but elevation streams are still missing. Race cards will not show the chart yet.',
                    );
                } else if (saveJson?.elevationReady === true && (cacheWarning || elevErr)) {
                    // Streams were backfilled on save — clear earlier elevation warnings.
                    setRouteProfileError(null);
                }
            }
        } catch (e: any) {
            if (e?.name === 'AbortError') return;
            setRouteProfileSegments([]);
            setRouteProfileLeadIn('');
            setRouteProfileSegmentId(null);
            setRouteProfileError(e?.message || 'Could not load route profile segments');
        } finally {
            if (!opts?.signal?.aborted) {
                setLoadingRouteProfile(false);
            }
        }
    };

    // Auto-load profile metadata when the selected route changes.
    useEffect(() => {
        setRouteProfileSegments([]);
        setRouteProfileLeadIn('');
        setRouteProfileSegmentId(null);
        setRouteProfileError(null);
        if (!formState.selectedRouteId || !selectedRoute) return;

        const controller = new AbortController();
        void loadRouteProfileSegments({ signal: controller.signal });
        return () => controller.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: reload on route/map change only
    }, [formState.selectedMap, formState.selectedRouteId, selectedRoute?.id]);

    const updateRouteProfileSegment = (index: number, patch: Partial<RouteProfileSegment>) => {
        setRouteProfileSegments((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
    };

    const moveRouteProfileSegment = (index: number, direction: -1 | 1) => {
        setRouteProfileSegments((prev) => {
            const nextIndex = index + direction;
            if (nextIndex < 0 || nextIndex >= prev.length) return prev;
            const copy = [...prev];
            const [item] = copy.splice(index, 1);
            copy.splice(nextIndex, 0, item);
            return copy;
        });
    };

    const sortRouteProfileSegmentsByDistance = () => {
        setRouteProfileSegments((prev) =>
            [...prev].sort((a, b) => {
                const aMin = Math.min(Number(a.fromKm) || 0, Number(a.toKm) || 0);
                const bMin = Math.min(Number(b.fromKm) || 0, Number(b.toKm) || 0);
                if (aMin !== bMin) return aMin - bMin;
                const aMax = Math.max(Number(a.fromKm) || 0, Number(a.toKm) || 0);
                const bMax = Math.max(Number(b.fromKm) || 0, Number(b.toKm) || 0);
                return aMax - bMax;
            })
        );
    };

    const addRouteProfileSegment = () => {
        setRouteProfileSegments((prev) => [
            ...prev,
            { name: 'Segment', type: 'segment', fromKm: '', toKm: '', direction: 'forward' },
        ]);
    };

    const removeRouteProfileSegment = (index: number) => {
        setRouteProfileSegments((prev) => prev.filter((_, i) => i !== index));
    };

    const saveRouteProfileSegments = async () => {
        if (!user) return;
        if (!routeProfileSegmentId) {
            setRouteProfileError('Load route profile first to resolve cache key.');
            return;
        }
        setSavingRouteProfile(true);
        setRouteProfileError(null);
        try {
            const token = await user.getIdToken();
            const payload = routeProfileSegments.map((seg) => ({
                name: (seg.name || '').trim() || 'Segment',
                type: seg.type,
                fromKm: Math.min(Number(seg.fromKm) || 0, Number(seg.toKm) || 0),
                toKm: Math.max(Number(seg.fromKm) || 0, Number(seg.toKm) || 0),
                direction: seg.direction === 'reverse' ? 'reverse' : 'forward',
            }));
            const leadInValue = routeProfileLeadIn !== '' ? parseFloat(routeProfileLeadIn) : null;
            const res = await fetch(`${API_URL}/route-elevation/${routeProfileSegmentId}/profile-segments`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                    profileSegments: payload,
                    ...(leadInValue !== null && Number.isFinite(leadInValue) ? { leadInDistance: leadInValue } : {}),
                    ...(selectedRoute?.map ? { world: selectedRoute.map } : {}),
                    ...(selectedRoute?.name ? { route: selectedRoute.name } : {}),
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(json?.message || `Failed to save (${res.status})`);
            }
            if (json?.elevationReady === false) {
                const detail = json?.elevationFetchError
                    ? `: ${json.elevationFetchError}`
                    : '';
                setRouteProfileError(
                    `Profile segments saved, but race-card elevation chart is not ready${detail}`,
                );
                alert('Profile segments saved, but elevation streams are still missing — race cards will not show the chart yet.');
            } else {
                alert('Route profile segments saved.');
            }
        } catch (e: any) {
            setRouteProfileError(e?.message || 'Could not save route profile segments');
        } finally {
            setSavingRouteProfile(false);
        }
    };

    return (
        <RaceFormProvider value={{
            formState, segments, segmentsByLap, status,
            onFieldChange, onToggleSegment,
            onAddEventConfig, onRemoveEventConfig, onUpdateEventConfig, onToggleConfigSprint,
            onAddSingleModeCategory, onRemoveSingleModeCategory, onUpdateSingleModeCategory, onToggleSingleModeCategorySprint,
            onAddRaceGroup, onRemoveRaceGroup, onUpdateRaceGroup,
            onAddGroupCategory, onRemoveGroupCategory, onUpdateGroupCategory, onToggleGroupCategorySprint, onToggleGroupSprint,
        }}>
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
                <RaceBasicFields />

                {/* Route Selection */}
                <RaceRouteSelector routes={routes} />

                {/* Route Details & Configuration */}
                {selectedRoute && (
                    <div className="p-4 bg-muted/50 rounded-lg border border-border">
                        {/* Event Mode */}
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-muted-foreground mb-2">
                                Result Source Configuration
                            </label>
                            <div className="flex flex-wrap gap-4 mb-4">
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
                                    <span className="text-sm">Multi-Category (One Event per Category)</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="eventMode"
                                        checked={formState.eventMode === 'grouped'}
                                        onChange={() => onFieldChange('eventMode', 'grouped')}
                                        className="text-primary focus:ring-primary"
                                    />
                                    <span className="text-sm">Grouped (Multiple Events, Each Covering Multiple Categories)</span>
                                </label>
                            </div>

                            {formState.eventMode === 'single' && <SingleModeConfig />}
                            {formState.eventMode === 'multi' && <MultiModeConfig />}
                            {formState.eventMode === 'grouped' && <GroupedModeConfig />}

                            <p className="text-xs text-muted-foreground mt-2">
                                {formState.eventMode === 'single'
                                    ? 'Used to fetch race results automatically from a single event.'
                                    : formState.eventMode === 'multi'
                                    ? 'Map one Zwift Event per category (e.g. Event 101 → Elite Men, Event 102 → H40).'
                                    : 'Group multiple categories under each Zwift Event (e.g. "High end" event covers Diamond + Ruby).'}
                            </p>
                        </div>

                        {/* Route profile ownership note */}
                        <div className="border-t border-border pt-4 mt-4">
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                                <label className="block font-medium text-card-foreground">
                                    Route profile segments
                                </label>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => void loadRouteProfileSegments()}
                                        disabled={loadingRouteProfile || !selectedRoute}
                                        className="px-3 py-1.5 text-xs rounded bg-secondary text-secondary-foreground hover:opacity-90 disabled:opacity-50"
                                    >
                                        {loadingRouteProfile ? 'Loading...' : 'Reload'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (
                                                routeProfileSegments.length > 0
                                                && !confirm('Replace current profile segments with the route’s default Strava-linked segment placements?')
                                            ) {
                                                return;
                                            }
                                            void loadRouteProfileSegments({ forceDefaults: true });
                                        }}
                                        disabled={loadingRouteProfile || !selectedRoute}
                                        className="px-3 py-1.5 text-xs rounded bg-secondary text-secondary-foreground hover:opacity-90 disabled:opacity-50"
                                        title="Replace with Zwift route segment placements (start/end km)"
                                    >
                                        Reset from route segments
                                    </button>
                                    <button
                                        type="button"
                                        onClick={addRouteProfileSegment}
                                        className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:opacity-90"
                                    >
                                        + Add segment
                                    </button>
                                    <button
                                        type="button"
                                        onClick={sortRouteProfileSegmentsByDistance}
                                        className="px-3 py-1.5 text-xs rounded bg-secondary text-secondary-foreground hover:opacity-90"
                                    >
                                        Sort by km
                                    </button>
                                    <button
                                        type="button"
                                        onClick={saveRouteProfileSegments}
                                        disabled={savingRouteProfile || !routeProfileSegmentId}
                                        className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
                                    >
                                        {savingRouteProfile ? 'Saving...' : 'Save to elevation_cache'}
                                    </button>
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground mb-3">
                                Labels for the public route elevation chart. Start/end km are taken from the
                                route’s Strava-linked Zwift segments (not from Strava elevation streams).
                                Separate from race sprint picks above. Stored in `elevation_cache`.
                                {routeProfileSegmentId ? ` Cache key: ${routeProfileSegmentId}` : ''}
                            </p>
                            {routeProfileError && (
                                <div className="text-xs text-red-600 dark:text-red-400 mb-2">{routeProfileError}</div>
                            )}
                            <div className="mb-3 flex items-center gap-3">
                                <label className="text-xs text-muted-foreground whitespace-nowrap">Lead-in distance (km)</label>
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    value={routeProfileLeadIn}
                                    onChange={(e) => setRouteProfileLeadIn(e.target.value)}
                                    placeholder="e.g. 2.5"
                                    className="w-24 p-1.5 border border-input rounded bg-background text-foreground text-sm"
                                />
                                <span className="text-xs text-muted-foreground">Added to from/to km when displaying segments on route cards</span>
                            </div>
                            <div className="space-y-2">
                                {routeProfileSegments.length === 0 && !loadingRouteProfile && (
                                    <div className="text-xs text-muted-foreground border border-dashed border-border rounded p-3">
                                        {!selectedRoute
                                            ? 'Select a route to load profile segments.'
                                            : 'No Strava-linked segments found on this route. Add them manually, or pick another route.'}
                                    </div>
                                )}
                                {loadingRouteProfile && (
                                    <div className="text-xs text-muted-foreground border border-dashed border-border rounded p-3">
                                        Loading route profile…
                                    </div>
                                )}
                                <datalist id="route-profile-segment-names">
                                    {lap1SegmentOptions.map(opt => (
                                        <option key={opt.name} value={opt.name} />
                                    ))}
                                </datalist>
                                {routeProfileSegments.map((seg, i) => (
                                    <div key={i} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end border border-border rounded p-2">
                                        <div className="md:col-span-4">
                                            <label className="block text-[11px] text-muted-foreground mb-1">Name</label>
                                            <input
                                                type="text"
                                                value={seg.name}
                                                list="route-profile-segment-names"
                                                onChange={(e) => {
                                                    const newName = e.target.value;
                                                    const match = lap1SegmentOptions.find(opt => opt.name === newName);
                                                    const patch: Partial<RouteProfileSegment> = { name: newName };
                                                    if (match) patch.direction = match.direction;
                                                    updateRouteProfileSegment(i, patch);
                                                }}
                                                className="w-full p-1.5 border border-input rounded bg-background text-foreground text-sm"
                                            />
                                        </div>
                                        <div className="md:col-span-2">
                                            <label className="block text-[11px] text-muted-foreground mb-1">Type</label>
                                            <select
                                                value={seg.type}
                                                onChange={(e) => updateRouteProfileSegment(i, { type: e.target.value as RouteProfileSegment['type'] })}
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
                                                type="text"
                                                inputMode="decimal"
                                                value={seg.fromKm}
                                                onChange={(e) => updateRouteProfileSegment(i, { fromKm: e.target.value })}
                                                className="w-full p-1.5 border border-input rounded bg-background text-foreground text-sm"
                                            />
                                        </div>
                                        <div className="md:col-span-2">
                                            <label className="block text-[11px] text-muted-foreground mb-1">To km</label>
                                            <input
                                                type="text"
                                                inputMode="decimal"
                                                value={seg.toKm}
                                                onChange={(e) => updateRouteProfileSegment(i, { toKm: e.target.value })}
                                                className="w-full p-1.5 border border-input rounded bg-background text-foreground text-sm"
                                            />
                                        </div>
                                        <div className="md:col-span-1">
                                            <label className="block text-[11px] text-muted-foreground mb-1">Dir</label>
                                            <select
                                                value={seg.direction}
                                                onChange={(e) => updateRouteProfileSegment(i, { direction: e.target.value as RouteProfileSegment['direction'] })}
                                                className="w-full p-1.5 border border-input rounded bg-background text-foreground text-sm"
                                            >
                                                <option value="forward">F</option>
                                                <option value="reverse">R</option>
                                            </select>
                                        </div>
                                        <div className="md:col-span-1">
                                            <div className="flex gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() => moveRouteProfileSegment(i, -1)}
                                                    disabled={i === 0}
                                                    className="w-1/2 p-1.5 text-xs rounded bg-secondary text-secondary-foreground hover:opacity-90 disabled:opacity-50"
                                                    title="Move up"
                                                >
                                                    ↑
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => moveRouteProfileSegment(i, 1)}
                                                    disabled={i === routeProfileSegments.length - 1}
                                                    className="w-1/2 p-1.5 text-xs rounded bg-secondary text-secondary-foreground hover:opacity-90 disabled:opacity-50"
                                                    title="Move down"
                                                >
                                                    ↓
                                                </button>
                                            </div>
                                        </div>
                                        <div className="md:col-span-1">
                                            <button
                                                type="button"
                                                onClick={() => removeRouteProfileSegment(i)}
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
        </RaceFormProvider>
    );
}
