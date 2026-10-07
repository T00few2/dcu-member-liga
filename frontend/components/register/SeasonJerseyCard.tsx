'use client';

import type { WornSeasonJersey } from '@/lib/seasonJerseys';

export default function SeasonJerseyCard({ jersey }: { jersey: WornSeasonJersey }) {
    return (
        <div className="p-4 rounded-lg border border-border bg-muted/30">
            <h3 className="text-sm font-semibold text-card-foreground mb-3">Sæsontrøje</h3>
            <div className="flex gap-4 items-start">
                <div className="w-20 h-20 shrink-0 rounded-md border border-border bg-background overflow-hidden flex items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={jersey.src}
                        alt={jersey.alt}
                        className="w-full h-full object-contain"
                    />
                </div>
                <div className="min-w-0 space-y-1">
                    <p className="font-medium text-foreground">{jersey.alt}</p>
                    <p className="text-sm text-muted-foreground">{jersey.line}</p>
                </div>
            </div>
        </div>
    );
}
