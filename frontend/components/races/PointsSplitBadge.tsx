'use client';

import { calculateRacePointsSplit } from '@/lib/racePointsSplit';
import type { Race } from '@/types/live';

interface PointsSplitBadgeProps {
    race: Race;
    finishPoints: number[];
    sprintPoints: number[];
    ridersCount?: number;
    compact?: boolean;
}

export default function PointsSplitBadge({
    race,
    finishPoints,
    sprintPoints,
    ridersCount,
    compact = false,
}: PointsSplitBadgeProps) {
    const split = calculateRacePointsSplit(race, finishPoints, sprintPoints, ridersCount);

    const hoverText = split.total > 0
        ? `Finish: ${split.finishPct.toFixed(1)}% (${split.finishTotal} pts)\nSprint: ${split.sprintPct.toFixed(1)}% (${split.sprintTotal} pts)\nSegments: ${split.sprintSegments}\nRiders: ${split.ridersCount}`
        : 'No points split available (check points settings)';

    return (
        <div className="flex items-center gap-3">
            <div
                className={compact ? 'w-10 h-10 rounded-full border border-border' : 'w-12 h-12 rounded-full border border-border'}
                style={{
                    background: split.total > 0
                        ? `conic-gradient(#2563eb 0 ${split.finishPct}%, #16a34a ${split.finishPct}% 100%)`
                        : 'var(--muted)',
                }}
                title={hoverText}
                aria-label="Points split pie chart"
            />
            <div className={compact ? 'text-[11px] leading-4' : 'text-xs leading-5'}>
                <div className="text-muted-foreground">
                    Finish: <span className="font-medium text-foreground">{split.finishTotal}</span>
                </div>
                <div className="text-muted-foreground">
                    Sprint: <span className="font-medium text-foreground">{split.sprintTotal}</span>
                </div>
            </div>
        </div>
    );
}

