'use client';

import { useCallback, useRef, useState } from 'react';
import RouteElevationChart from '@/components/races/RouteElevationChart';
import LiveRiderOverlay from '@/components/live-race/LiveRiderOverlay';
import LiveRiderTooltip from '@/components/live-race/LiveRiderTooltip';
import type { RiderGroup } from '@/lib/live-race/cluster';
import type { CurrentLiveRace, Sprint } from '@/types/live';

interface Props {
    race: CurrentLiveRace;
    laps: number;
    /** Point sprints to mark on the profile (usually `activeTab?.sprints`). */
    pointSegments?: Sprint[];
    groups: RiderGroup[];
    selectedRiderIds: Set<string> | null;
    /** Omit to render a static profile: no click-to-select and no hover tooltip. */
    onSelectGroup?: (group: RiderGroup) => void;
    /** Drop the card frame and heading (used by the stream overlay). */
    bare?: boolean;
    height?: number;
}

const noop = () => { };

/**
 * The live route profile with the rider groups drawn on top of it.
 * Shared by `/live-race` and the `/live-race/overlay/profile` stream overlay.
 */
export default function LiveRaceProfileCard({
    race,
    laps,
    pointSegments,
    groups,
    selectedRiderIds,
    onSelectGroup,
    bare = false,
    height,
}: Props) {
    const chartWrapRef = useRef<HTMLDivElement>(null);
    const [hoverGroup, setHoverGroup] = useState<RiderGroup | null>(null);
    const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });

    const interactive = !!onSelectGroup;

    const handleGroupHover = useCallback(
        (group: RiderGroup | null, clientX: number, clientY: number) => {
            if (!group || !chartWrapRef.current) {
                setHoverGroup(null);
                return;
            }
            const rect = chartWrapRef.current.getBoundingClientRect();
            setHoverGroup(group);
            setHoverPos({ x: clientX - rect.left, y: clientY - rect.top });
        },
        [],
    );

    const body = race.map && race.routeName ? (
        <div ref={chartWrapRef} className="relative">
            <RouteElevationChart
                worldName={race.map}
                routeName={race.routeName}
                laps={laps}
                routeId={race.routeId}
                pointSegments={pointSegments}
                height={height}
                overlay={(ctx) => (
                    <LiveRiderOverlay
                        groups={groups}
                        selectedRiderIds={selectedRiderIds}
                        onGroupClick={onSelectGroup ?? noop}
                        onGroupHover={interactive ? handleGroupHover : noop}
                        {...ctx}
                    />
                )}
            />
            {interactive && (
                <LiveRiderTooltip group={hoverGroup} anchorX={hoverPos.x} anchorY={hoverPos.y} />
            )}
        </div>
    ) : (
        <p className="text-sm text-muted-foreground">Ruteprofil ikke tilgængelig.</p>
    );

    if (bare) return body;

    return (
        <div className="border border-border rounded-lg bg-card p-4">
            <h2 className="text-sm font-semibold text-card-foreground mb-2">Ruteprofil · live</h2>
            {body}
        </div>
    );
}
