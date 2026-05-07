'use client';

import { useState } from 'react';
import type { Race, LoadingStatus } from '@/types/admin';
import type { LeagueSettings } from '@/types/admin';

interface RaceListProps {
    races: Race[];
    leagueSettings: LeagueSettings;
    editingRaceId: string | null;
    status: LoadingStatus;
    onEdit: (race: Race) => void;
    onDelete: (id: string) => void;
}

export default function RaceList({
    races,
    leagueSettings,
    editingRaceId,
    status,
    onEdit,
    onDelete,
}: RaceListProps) {
    const [pointsPreviewRiders, setPointsPreviewRiders] = useState(30);

    const getSegmentKey = (seg: { key?: string; id?: string; count?: number }): string | null => {
        if (seg?.key) return seg.key;
        if (seg?.id) return `${seg.id}_${seg.count ?? ''}`;
        return null;
    };

    const getSelectedSegmentCount = (race: Race): number => {
        const segmentKeys = new Set<string>();

        const addSegments = (segments?: { key?: string; id?: string; count?: number }[]) => {
            for (const seg of segments || []) {
                const key = getSegmentKey(seg);
                if (key) segmentKeys.add(key);
            }
        };

        // Backward-compatible top-level segment keys
        for (const segKey of race.selectedSegments || []) {
            segmentKeys.add(segKey);
        }

        // Single-race top-level segment selection
        addSegments(race.sprints);

        // Single event mode with per-category segment selection
        for (const cfg of race.singleModeCategories || []) {
            addSegments(cfg.sprints);
        }

        // Multi event mode with per-event segment selection
        for (const cfg of race.eventConfiguration || []) {
            addSegments(cfg.sprints);
        }

        // Grouped mode: group-level and per-category segments
        for (const group of race.raceGroups || []) {
            addSegments(group.sprints);
            for (const cat of group.categories || []) {
                addSegments(cat.sprints);
            }
        }

        return segmentKeys.size;
    };

    const getSprintSegmentCountForPoints = (race: Race): number => {
        const segmentKeys = new Set<string>();
        const defaultType = race.segmentType || 'sprint';

        // Top-level race segments (single mode)
        if (defaultType !== 'split') {
            for (const key of race.selectedSegments || []) {
                segmentKeys.add(key);
            }
            for (const seg of race.sprints || []) {
                const key = getSegmentKey(seg);
                if (key) segmentKeys.add(key);
            }
        }

        // Single mode category configs
        for (const cfg of race.singleModeCategories || []) {
            if ((cfg.segmentType || defaultType) === 'split') continue;
            for (const seg of cfg.sprints || []) {
                const key = getSegmentKey(seg);
                if (key) segmentKeys.add(key);
            }
        }

        // Multi mode event configs
        for (const cfg of race.eventConfiguration || []) {
            if ((cfg.segmentType || defaultType) === 'split') continue;
            for (const seg of cfg.sprints || []) {
                const key = getSegmentKey(seg);
                if (key) segmentKeys.add(key);
            }
        }

        // Grouped mode: group-level and per-category segments
        for (const group of race.raceGroups || []) {
            const groupType = group.segmentType || defaultType;
            if (groupType !== 'split') {
                for (const seg of group.sprints || []) {
                    const key = getSegmentKey(seg);
                    if (key) segmentKeys.add(key);
                }
            }
            for (const cat of group.categories || []) {
                const catType = cat.segmentType || groupType;
                if (catType === 'split') continue;
                for (const seg of cat.sprints || []) {
                    const key = getSegmentKey(seg);
                    if (key) segmentKeys.add(key);
                }
            }
        }

        return segmentKeys.size;
    };

    const sum = (vals: number[]) => vals.reduce((acc, n) => acc + n, 0);

    return (
        <div className="bg-card rounded-lg shadow overflow-hidden border border-border">
            <div className="flex flex-col gap-4 p-6 border-b border-border">
                <div>
                    <h2 className="text-xl font-semibold text-card-foreground">Scheduled Races</h2>
                    <div className="mt-2 flex items-center gap-2">
                        <label className="text-sm text-muted-foreground font-medium">
                            Riders per category (points preview):
                        </label>
                        <input
                            type="number"
                            min="1"
                            value={pointsPreviewRiders}
                            onChange={(e) => setPointsPreviewRiders(Math.max(1, parseInt(e.target.value) || 1))}
                            className="w-24 p-1.5 border border-input rounded bg-background text-foreground text-sm"
                        />
                    </div>
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-muted/50 text-muted-foreground">
                        <tr>
                            <th className="px-6 py-3">Date</th>
                            <th className="px-6 py-3">Name</th>
                            <th className="px-6 py-3">Route</th>
                            <th className="px-6 py-3">Sprints</th>
                            <th className="px-6 py-3">Points Split</th>
                            <th className="px-6 py-3 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {races.map(race => {
                            const riders = Math.max(1, pointsPreviewRiders);
                            const sprintSegments = getSprintSegmentCountForPoints(race);

                            const finishDist = (leagueSettings.finishPoints || []).slice(0, riders);
                            const finishTotal = sum(finishDist);
                            const sprintDist = (leagueSettings.sprintPoints || []).slice(0, riders);
                            const sprintPerSegment = sum(sprintDist);
                            const sprintTotal = sprintPerSegment * sprintSegments;
                            const combinedTotal = finishTotal + sprintTotal;
                            const finishPct = combinedTotal > 0 ? (finishTotal / combinedTotal) * 100 : 0;
                            const sprintPct = combinedTotal > 0 ? (sprintTotal / combinedTotal) * 100 : 0;
                            const pieHoverText = combinedTotal > 0
                                ? `Finish: ${finishPct.toFixed(1)}% (${finishTotal} pts)\nSprint: ${sprintPct.toFixed(1)}% (${sprintTotal} pts)\nTotal: ${combinedTotal} pts`
                                : 'No points to preview (check points settings and sprint segments)';

                            return (
                                <tr
                                    key={race.id}
                                    className={editingRaceId === race.id
                                        ? 'bg-primary/5'
                                        : 'hover:bg-muted/20 transition'
                                    }
                                >
                                    <td className="px-6 py-4 text-card-foreground whitespace-nowrap">
                                        {new Date(race.date).toLocaleDateString()}{' '}
                                        <span className="text-muted-foreground">
                                            {new Date(race.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 font-medium text-card-foreground">{race.name}</td>
                                    <td className="px-6 py-4 text-muted-foreground">
                                        <div className="font-medium text-card-foreground">{race.map}</div>
                                        <div className="text-xs">{race.routeName} ({race.laps} laps)</div>
                                        {race.eventMode === 'multi' ? (
                                            <div className="text-xs text-primary/70">
                                                {race.eventConfiguration?.length} Linked Events
                                            </div>
                                        ) : (
                                            race.eventId && (
                                                <div className="text-xs text-primary/70">Event ID: {race.eventId}</div>
                                            )
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-muted-foreground">
                                        {getSelectedSegmentCount(race)} selected
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-3">
                                            <div
                                                className="w-12 h-12 rounded-full border border-border"
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
                                                    Sprint: <span className="font-medium text-foreground">{sprintTotal}</span>
                                                </div>
                                                <div className="text-muted-foreground">
                                                    Segments: <span className="font-medium text-foreground">{sprintSegments}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right space-x-2 whitespace-nowrap">
                                        <button
                                            onClick={() => onEdit(race)}
                                            className="text-primary hover:text-primary/80 font-medium px-2 py-1"
                                        >
                                            Edit
                                        </button>
                                        <button
                                            onClick={() => onDelete(race.id)}
                                            className="text-destructive hover:text-destructive/80 font-medium px-2 py-1"
                                        >
                                            Delete
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                        {races.length === 0 && (
                            <tr>
                                <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">
                                    No races scheduled.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
