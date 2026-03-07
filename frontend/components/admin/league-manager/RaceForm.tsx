'use client';

import { User } from 'firebase/auth';
import type { Route, Segment, RaceFormState, EventConfig, CategoryConfig, LoadingStatus } from '@/types/admin';
import { getRouteHelpers } from '@/hooks/useLeagueData';
import SegmentPicker from './SegmentPicker';
import SingleModeConfig from './SingleModeConfig';
import MultiModeConfig from './MultiModeConfig';

import { API_URL } from '@/lib/api';

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
    onCancel,
    onSave,
}: RaceFormProps) {
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
