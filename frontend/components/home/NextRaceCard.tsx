'use client';

import Link from 'next/link';
import type { Race } from '@/types/live';
import type { LeagueSettings } from '@/types/admin';
import RaceCard from '@/components/races/RaceCard';
import RaceCountdownText from '@/components/home/RaceCountdownText';
import { useCurrentLiveRaceQuery, useStageRacesQuery } from '@/hooks/queries';
import { seasonClassLabel } from '@/lib/seasonUi';

interface NextRaceCardProps {
    race: Race;
    leagueSettings: LeagueSettings | null;
    userCategory?: string | null;
}

export default function NextRaceCard({ race, leagueSettings, userCategory }: NextRaceCardProps) {
    const { data: liveRace } = useCurrentLiveRaceQuery();
    const stageRacesQuery = useStageRacesQuery();
    const isThisRaceLive = liveRace?.id === race.id;
    const event = race.stageRaceId
        ? (stageRacesQuery.data ?? []).find((e) => e.id === race.stageRaceId)
        : undefined;
    const isTour = event?.seasonClass === 'tour';
    const stageLabel =
        isTour && race.stageIndex != null
            ? (event?.name
                ? `${event.name} etape ${race.stageIndex}`
                : `Etape ${race.stageIndex}`)
            : null;

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
                        Se hele sæsonkalenderen &rarr;
                    </Link>
                </div>
            </div>
            {!isThisRaceLive && (
                <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-sm">
                    <span className="text-muted-foreground">Starter om</span>
                    <RaceCountdownText
                        date={race.date}
                        className="font-mono font-bold text-foreground tabular-nums"
                    />
                </div>
            )}
            <RaceCard
                race={race}
                leagueSettings={leagueSettings}
                userCategory={userCategory}
                eventName={isTour ? null : event?.name}
                seasonClassLabel={isTour ? null : seasonClassLabel(event?.seasonClass)}
                stageLabel={stageLabel}
            />
        </div>
    );
}
