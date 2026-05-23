'use client';

import { useMemo } from 'react';
import type { RouteElevationOverlayContext } from '@/components/races/RouteElevationChart';
import type { RiderGroup } from '@/lib/live-race/cluster';
import { findSelectedGroupIndex } from '@/lib/live-race/group-match';

interface Props extends RouteElevationOverlayContext {
    groups: RiderGroup[];
    selectedRiderIds: Set<string> | null;
    onGroupClick: (group: RiderGroup) => void;
    onGroupHover: (group: RiderGroup | null, clientX: number, clientY: number) => void;
}

// SVG attributes cannot use Tailwind hsl(var(...)) — use literal hex.
const COLOR_REGISTERED = '#c00418';
const COLOR_UNREGISTERED = '#64748b';
const COLOR_SELECTION = '#f59e0b';
const COLOR_MARKER_STROKE = '#ffffff';

function markerLayout(
    group: RiderGroup,
    xScale: (km: number) => number,
    yScale: (alt: number) => number,
    altitudeAt: (km: number) => number,
    isSelected: boolean,
) {
    const count = group.riders.length;
    const radius = Math.min(10, 5 + Math.sqrt(Math.max(0, count - 1)) * 1.2);
    const px = xScale(group.chartKm);
    const alt = altitudeAt(group.chartKm);
    const topPad = isSelected ? radius + 12 : radius + 2;
    const py = Math.max(topPad, yScale(alt) - radius - 2);
    const curveY = yScale(alt);
    return { px, py, radius, curveY, count };
}

function GroupMarker({
    x,
    y,
    radius,
    fill,
    count,
}: {
    x: number;
    y: number;
    radius: number;
    fill: string;
    count: number;
}) {
    const showCount = count > 1;
    return (
        <g>
            <circle
                cx={x}
                cy={y}
                r={radius}
                fill={fill}
                stroke={COLOR_MARKER_STROKE}
                strokeWidth={1.5}
            />
            {showCount && (
                <text
                    x={x}
                    y={y + 0.5}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="#ffffff"
                    fontSize={Math.max(8, radius * 1.05)}
                    fontWeight={700}
                    style={{ pointerEvents: 'none' }}
                >
                    {count}
                </text>
            )}
        </g>
    );
}

/** Selection ring drawn on top of all markers — separate layer so it is never hidden. */
function SelectionRing({
    x,
    y,
    radius,
}: {
    x: number;
    y: number;
    radius: number;
}) {
    return (
        <g pointerEvents="none">
            <circle
                cx={x}
                cy={y}
                r={radius + 11}
                fill={COLOR_SELECTION}
                fillOpacity={0.22}
            />
            <circle
                cx={x}
                cy={y}
                r={radius + 7}
                fill="none"
                stroke="#ffffff"
                strokeWidth={3}
            />
            <circle
                cx={x}
                cy={y}
                r={radius + 4}
                fill="none"
                stroke={COLOR_SELECTION}
                strokeWidth={2.5}
            />
        </g>
    );
}

export default function LiveRiderOverlay({
    groups,
    selectedRiderIds,
    totalDistanceKm,
    xScale,
    yScale,
    altitudeAt,
    chartHeight,
    onGroupClick,
    onGroupHover,
}: Props) {
    const selectedIdx = useMemo(
        () => findSelectedGroupIndex(groups, selectedRiderIds),
        [groups, selectedRiderIds],
    );

    const frontGroup = groups[groups.length - 1];
    const missingKm = frontGroup
        ? Math.max(0, totalDistanceKm - frontGroup.chartKm)
        : totalDistanceKm;

    const selectionLayout =
        selectedIdx >= 0 && groups[selectedIdx]
            ? markerLayout(groups[selectedIdx], xScale, yScale, altitudeAt, true)
            : null;

    // Non-selected markers first, then selection ring on top.
    const renderOrder = groups
        .map((_, i) => i)
        .filter((i) => i !== selectedIdx)
        .concat(selectedIdx >= 0 ? [selectedIdx] : []);

    return (
        <g>
            {renderOrder.map((idx) => {
                const group = groups[idx];
                const isSelected = idx === selectedIdx;
                const hasRegistered = group.riders.some((r) => r.registered);
                const fill = hasRegistered ? COLOR_REGISTERED : COLOR_UNREGISTERED;
                const { px, py, radius, curveY, count } = markerLayout(
                    group,
                    xScale,
                    yScale,
                    altitudeAt,
                    isSelected,
                );
                const isFront = idx === groups.length - 1;

                return (
                    <g key={`${group.chartKm}-${idx}-${groupRiderKeyShort(group)}`}>
                        <line
                            x1={px}
                            y1={py + radius}
                            x2={px}
                            y2={curveY}
                            stroke={fill}
                            strokeWidth={1.2}
                            strokeOpacity={0.6}
                            style={{ pointerEvents: 'none' }}
                        />
                        <GroupMarker x={px} y={py} radius={radius} fill={fill} count={count} />
                        <rect
                            x={px - radius - 8}
                            y={py - radius - 8}
                            width={radius * 2 + 16}
                            height={radius * 2 + 16}
                            fill="transparent"
                            style={{ cursor: 'pointer' }}
                            onMouseEnter={(e) => onGroupHover(group, e.clientX, e.clientY)}
                            onMouseLeave={() => onGroupHover(null, 0, 0)}
                            onClick={() => onGroupClick(group)}
                        />
                        {isFront && missingKm > 0.05 && (
                            <text
                                x={px}
                                y={Math.min(chartHeight - 4, py + radius + 14)}
                                textAnchor="middle"
                                fill={COLOR_REGISTERED}
                                fontSize={10}
                                fontWeight={700}
                                style={{ pointerEvents: 'none' }}
                            >
                                {missingKm.toFixed(0)} km
                            </text>
                        )}
                    </g>
                );
            })}

            {selectionLayout && (
                <SelectionRing
                    x={selectionLayout.px}
                    y={selectionLayout.py}
                    radius={selectionLayout.radius}
                />
            )}
        </g>
    );
}

function groupRiderKeyShort(group: RiderGroup): string {
    return group.riders[0]?.userId?.slice(0, 6) ?? 'x';
}
