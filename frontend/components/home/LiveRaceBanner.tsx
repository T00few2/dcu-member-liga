'use client';

import Link from 'next/link';
import { useCurrentLiveRaceQuery } from '@/hooks/queries';

export default function LiveRaceBanner() {
    const { data: liveRace } = useCurrentLiveRaceQuery();

    if (!liveRace) return null;

    return (
        <Link
            href="/live-race"
            className="flex items-center justify-between gap-4 rounded-xl border border-primary/40 bg-primary/10 px-5 py-4 shadow-sm hover:bg-primary/15 hover:border-primary/60 transition-colors group"
        >
            <div className="flex items-center gap-3 min-w-0">
                <span className="relative flex h-3 w-3 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex h-3 w-3 rounded-full bg-primary" />
                </span>
                <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-wider text-primary">Live nu</p>
                    <p className="text-sm font-semibold text-card-foreground truncate">{liveRace.name}</p>
                </div>
            </div>
            <span className="shrink-0 text-sm font-bold text-primary group-hover:underline">
                Se live &rarr;
            </span>
        </Link>
    );
}
