'use client';

import { useEffect, useMemo, useState } from 'react';
import RouteElevationChart from '@/components/races/RouteElevationChart';
import { fromTimestamp, formatDateLong, formatTimeWithTz } from '@/lib/formatDate';
import type { CurrentLiveRace, Sprint } from '@/types/live';

interface Props {
    race: CurrentLiveRace;
}

function getFirstTabInfo(race: CurrentLiveRace): { laps: number; sprints: Sprint[] } {
    if (race.eventMode === 'grouped' && race.raceGroups?.length) {
        const group = race.raceGroups[0];
        const cat = group.categories?.[0];
        return {
            laps: (cat?.laps ?? group.laps ?? race.laps ?? 1),
            sprints: (cat?.sprints ?? group.sprints ?? []),
        };
    }
    if (race.eventConfiguration?.length) {
        const cfg = race.eventConfiguration[0];
        return { laps: cfg.laps ?? race.laps ?? 1, sprints: cfg.sprints ?? [] };
    }
    if (race.singleModeCategories?.length) {
        const cfg = race.singleModeCategories[0];
        return { laps: cfg.laps ?? race.laps ?? 1, sprints: cfg.sprints ?? [] };
    }
    return { laps: race.laps ?? 1, sprints: [] };
}

const pad = (n: number) => String(n).padStart(2, '0');

export default function UpcomingRaceCountdown({ race }: Props) {
    const raceDate = useMemo(() => fromTimestamp(race.date ?? null), [race.date]);

    const [secondsLeft, setSecondsLeft] = useState(() =>
        raceDate ? Math.max(0, Math.floor((raceDate.getTime() - Date.now()) / 1000)) : 0,
    );

    useEffect(() => {
        if (!raceDate) return;
        const tick = () => setSecondsLeft(Math.max(0, Math.floor((raceDate.getTime() - Date.now()) / 1000)));
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [raceDate]);

    const { laps, sprints } = useMemo(() => getFirstTabInfo(race), [race]);

    const days = Math.floor(secondsLeft / 86400);
    const hours = Math.floor((secondsLeft % 86400) / 3600);
    const minutes = Math.floor((secondsLeft % 3600) / 60);
    const seconds = secondsLeft % 60;

    // totalDistance is in km; compute per-category distance the same way the live page does
    const totalKm = useMemo(() => {
        const raceLaps = Math.max(1, race.laps ?? 1);
        const lapKm = (race.totalDistance ?? 0) / raceLaps;
        const tabKm = lapKm * Math.max(1, laps);
        return tabKm > 0 ? tabKm : null;
    }, [race.totalDistance, race.laps, laps]);

    const dateLabel = raceDate
        ? `${formatDateLong(raceDate)} · ${formatTimeWithTz(raceDate)}`
        : null;

    const meta = [
        race.map,
        race.routeName,
        laps ? `${laps} omgang${laps !== 1 ? 'e' : ''}` : null,
        totalKm ? `${totalKm.toFixed(1)} km` : null,
        dateLabel,
    ]
        .filter(Boolean)
        .join(' · ');

    return (
        <div className="container mx-auto px-4 py-6 max-w-5xl">
            <header className="mb-4">
                <h1 className="text-2xl font-bold text-card-foreground">Live løb</h1>
                <p className="text-sm font-semibold text-muted-foreground mt-1">
                    Næste løb · {race.name}
                </p>
                {meta && <p className="text-xs text-muted-foreground mt-0.5">{meta}</p>}
            </header>

            <div className="border border-border rounded-lg bg-card p-4">
                {race.map && race.routeName ? (
                    <div className="relative">
                        <RouteElevationChart
                            worldName={race.map}
                            routeName={race.routeName}
                            laps={laps}
                            pointSegments={sprints}
                            height={260}
                        />
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="bg-background/85 backdrop-blur-sm rounded-lg border border-border px-6 py-4 text-center">
                                {secondsLeft > 0 ? (
                                    <>
                                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
                                            Starter om
                                        </p>
                                        <div className="flex items-end gap-3">
                                            {days > 0 && (
                                                <div className="flex flex-col items-center">
                                                    <span className="text-3xl font-bold tabular-nums text-card-foreground leading-none">
                                                        {pad(days)}
                                                    </span>
                                                    <span className="text-xs text-muted-foreground mt-1.5">dage</span>
                                                </div>
                                            )}
                                            <div className="flex flex-col items-center">
                                                <span className="text-3xl font-bold tabular-nums text-card-foreground leading-none">
                                                    {pad(hours)}
                                                </span>
                                                <span className="text-xs text-muted-foreground mt-1.5">t</span>
                                            </div>
                                            <div className="flex flex-col items-center">
                                                <span className="text-3xl font-bold tabular-nums text-card-foreground leading-none">
                                                    {pad(minutes)}
                                                </span>
                                                <span className="text-xs text-muted-foreground mt-1.5">min</span>
                                            </div>
                                            <div className="flex flex-col items-center">
                                                <span className="text-3xl font-bold tabular-nums text-card-foreground leading-none">
                                                    {pad(seconds)}
                                                </span>
                                                <span className="text-xs text-muted-foreground mt-1.5">sek</span>
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <p className="text-sm font-semibold text-card-foreground">
                                        Løbet starter snart…
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                ) : (
                    <p className="text-sm text-muted-foreground">Ruteprofil ikke tilgængelig.</p>
                )}
            </div>
        </div>
    );
}
