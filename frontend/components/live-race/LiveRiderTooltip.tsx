'use client';

import type { RiderGroup } from '@/lib/live-race/cluster';

interface Props {
    group: RiderGroup | null;
    anchorX: number;
    anchorY: number;
}

export default function LiveRiderTooltip({ group, anchorX, anchorY }: Props) {
    if (!group) return null;

    const registered = group.riders.filter((r) => r.registered && r.name);
    const unknown = group.riders.length - registered.length;
    const show = registered.slice(0, 3);

    return (
        <div
            className="pointer-events-none absolute z-20 rounded border border-border bg-popover px-2 py-1.5 text-xs shadow-md"
            style={{ left: anchorX, top: anchorY, transform: 'translate(-50%, -100%)' }}
        >
            {show.map((r) => (
                <div key={r.userId} className="font-medium text-card-foreground">
                    {r.name}
                    {r.lap > 0 && (
                        <span className="text-muted-foreground font-normal"> · omg. {r.lap}</span>
                    )}
                </div>
            ))}
            {unknown > 0 && (
                <div className="text-muted-foreground">+ {unknown} ukendte</div>
            )}
            {group.riders.some((r) => r.inLeadIn) && (
                <div className="text-amber-600 font-semibold mt-0.5">I lead-in</div>
            )}
        </div>
    );
}
