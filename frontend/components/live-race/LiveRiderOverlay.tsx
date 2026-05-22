'use client';

import type { RouteElevationOverlayContext } from '@/components/races/RouteElevationChart';
import type { RiderGroup } from '@/lib/live-race/cluster';

interface Props extends RouteElevationOverlayContext {
    groups: RiderGroup[];
    selectedGroup: RiderGroup | null;
    onGroupClick: (group: RiderGroup) => void;
    onGroupHover: (group: RiderGroup | null, clientX: number, clientY: number) => void;
}

function GroupMarker({
    x,
    y,
    radius,
    color,
    count,
    isSelected,
}: {
    x: number;
    y: number;
    radius: number;
    color: string;
    count: number;
    isSelected: boolean;
}) {
    const showCount = count > 1;
    return (
        <g>
            {isSelected && (
                <circle
                    cx={x}
                    cy={y}
                    r={radius + 3}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                    opacity={0.6}
                />
            )}
            <circle
                cx={x}
                cy={y}
                r={radius}
                fill={color}
                stroke="hsl(var(--background))"
                strokeWidth={isSelected ? 2 : 1.5}
            />
            {showCount && (
                <text
                    x={x}
                    y={y + 0.5}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="hsl(var(--primary-foreground))"
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

export default function LiveRiderOverlay({
    groups,
    selectedGroup,
    totalDistanceKm,
    xScale,
    yScale,
    altitudeAt,
    chartHeight,
    onGroupClick,
    onGroupHover,
}: Props) {
    const frontGroup = groups[groups.length - 1];
    const missingKm = frontGroup
        ? Math.max(0, totalDistanceKm - frontGroup.chartKm)
        : totalDistanceKm;

    return (
        <g>
            {groups.map((group, idx) => {
                const count = group.riders.length;
                const hasRegistered = group.riders.some((r) => r.registered);
                const color = hasRegistered ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))';
                const px = xScale(group.chartKm);
                const alt = altitudeAt(group.chartKm);
                const radius = Math.min(10, 5 + Math.sqrt(Math.max(0, count - 1)) * 1.2);
                const py = Math.max(radius + 2, yScale(alt) - radius - 2);
                const isFront = idx === groups.length - 1;
                const isSelected = selectedGroup === group;

                return (
                    <g key={`${group.chartKm}-${idx}`}>
                        <line
                            x1={px}
                            y1={py + radius}
                            x2={px}
                            y2={yScale(alt)}
                            stroke={color}
                            strokeWidth={1.2}
                            strokeOpacity={0.6}
                            style={{ pointerEvents: 'none' }}
                        />
                        <GroupMarker
                            x={px}
                            y={py}
                            radius={radius}
                            color={color}
                            count={count}
                            isSelected={isSelected}
                        />
                        <rect
                            x={px - radius - 6}
                            y={py - radius - 4}
                            width={radius * 2 + 12}
                            height={radius * 2 + 8}
                            fill="transparent"
                            style={{ cursor: 'pointer' }}
                            onMouseEnter={(e) => onGroupHover(group, e.clientX, e.clientY)}
                            onMouseLeave={() => onGroupHover(null, 0, 0)}
                            onClick={() => onGroupClick(group)}
                        />
                        {isFront && missingKm > 0.05 && (
                            <text
                                x={px}
                                y={Math.min(chartHeight - 4, py + radius + 12)}
                                textAnchor="middle"
                                fill="hsl(var(--primary))"
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
        </g>
    );
}
