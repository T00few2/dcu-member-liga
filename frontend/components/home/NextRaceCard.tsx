'use client';

import Link from 'next/link';
import type { Race } from '@/types/live';
import type { LeagueSettings } from '@/types/admin';
import RaceCard from '@/components/races/RaceCard';
import { useCurrentLiveRaceQuery } from '@/hooks/queries';

interface NextRaceCardProps {
    race: Race;
    leagueSettings: LeagueSettings | null;
    userCategory?: string | null;
}

export default function NextRaceCard({ race, leagueSettings, userCategory }: NextRaceCardProps) {
    const { data: liveRace } = useCurrentLiveRaceQuery();
    const isThisRaceLive = liveRace?.id === race.id;

    return (
        <div>
            <div className="flex justify-between items-end mb-2 gap-4">
                <div className="text-primary text-sm font-bold uppercase tracking-wider">
                    {isThisRaceLive ? 'Løb i gang' : 'Næste Løb'}
                </div>
                <div className="flex items-center gap-4 shrink-0">
                    {isThisRaceLive && (
                        <Link
                            href="/live-race"
                            className="text-sm font-bold text-primary hover:underline inline-flex items-center gap-1.5"
                        >
                            <span className="relative flex h-2 w-2">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                            </span>
                            Se live &rarr;
                        </Link>
                    )}
                    <Link href="/schedule" className="text-sm text-primary hover:underline">
                        Se hele løbskalenderen &rarr;
                    </Link>
                </div>
            </div>
            <RaceCard race={race} leagueSettings={leagueSettings} userCategory={userCategory} />
        </div>
    );
}
