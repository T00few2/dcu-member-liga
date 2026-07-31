'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRacesQuery, useLeagueSettingsQuery, useStageRacesQuery } from '@/hooks/queries';
import type { Race } from '@/types/live';
import type { LeagueSettings } from '@/types/admin';
import { fromTimestamp } from '@/lib/formatDate';
import RaceCard from '@/components/races/RaceCard';
import {
    buildScheduleBlocks,
    seasonClassLabel,
    type ScheduleBlock,
} from '@/lib/seasonUi';

const DEFAULT_SETTINGS: LeagueSettings = {
    finishPoints: [],
    sprintPoints: [],
    leagueRankPoints: [],
    bestRacesCount: 5,
};

function raceIsFuture(race: Race, now: number): boolean {
    const t = fromTimestamp(race.date)?.getTime();
    return Number.isFinite(t) && (t as number) > now;
}

function filterBlocksByTime(blocks: ScheduleBlock[], now: number, mode: 'future' | 'past'): ScheduleBlock[] {
    return blocks
        .map((block): ScheduleBlock | null => {
            if (block.kind === 'orphan') {
                const future = raceIsFuture(block.race, now);
                if (mode === 'future' ? future : !future) return block;
                return null;
            }
            const stages = block.stages.filter((r) => {
                const future = raceIsFuture(r, now);
                return mode === 'future' ? future : !future;
            });
            if (stages.length === 0) return null;
            const ordered = mode === 'past'
                ? [...stages].sort((a, b) => {
                    const at = fromTimestamp(a.date)?.getTime() ?? 0;
                    const bt = fromTimestamp(b.date)?.getTime() ?? 0;
                    return bt - at;
                })
                : stages;
            return { kind: 'event', event: block.event, stages: ordered };
        })
        .filter((b): b is ScheduleBlock => b != null);
}

function ScheduleRaceCard({
    race,
    eventName,
    seasonClass,
    leagueSettings,
    userCategory,
    isPast,
    publicView,
}: {
    race: Race;
    eventName?: string | null;
    seasonClass?: string | null;
    leagueSettings: LeagueSettings | null;
    userCategory?: string | null;
    isPast?: boolean;
    publicView?: boolean;
}) {
    const isTour = seasonClass === 'tour';
    const stageLabel =
        isTour && race.stageIndex != null
            ? `Etape ${race.stageIndex}`
            : null;
    // Same badge slot as before — tour name from the event, not the generic "TOUR" label.
    const badgeLabel = isTour
        ? (eventName || null)
        : seasonClassLabel(seasonClass);

    return (
        <RaceCard
            race={race}
            leagueSettings={leagueSettings}
            userCategory={userCategory}
            isPast={isPast}
            showPointsSplit={!isPast && !publicView}
            variant={publicView ? 'public' : 'full'}
            eventName={isTour ? null : eventName}
            seasonClassLabel={badgeLabel}
            stageLabel={stageLabel}
        />
    );
}

function ScheduleBlocks({
    blocks,
    leagueSettings,
    userCategory,
    isPast,
    publicView,
}: {
    blocks: ScheduleBlock[];
    leagueSettings: LeagueSettings | null;
    userCategory?: string | null;
    isPast?: boolean;
    publicView?: boolean;
}) {
    return (
        <>
            {blocks.map((block) => {
                if (block.kind === 'orphan') {
                    return (
                        <ScheduleRaceCard
                            key={block.race.id}
                            race={block.race}
                            leagueSettings={leagueSettings}
                            userCategory={userCategory}
                            isPast={isPast}
                            publicView={publicView}
                        />
                    );
                }
                const classLabel = seasonClassLabel(block.event.seasonClass);
                return (
                    <div key={block.event.id} className="mb-8">
                        <div className="flex flex-wrap items-baseline gap-2 mb-3 px-1">
                            <h3 className="text-lg font-semibold text-card-foreground">{block.event.name}</h3>
                            {classLabel && (
                                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground bg-muted/40 border border-border px-2 py-0.5 rounded">
                                    {classLabel}
                                </span>
                            )}
                            {block.event.resultsPhase === 'finalized' && (
                                <span className="text-xs text-muted-foreground">Afsluttet</span>
                            )}
                        </div>
                        {block.stages.map((race) => (
                            <ScheduleRaceCard
                                key={race.id}
                                race={race}
                                eventName={block.event.name}
                                seasonClass={block.event.seasonClass}
                                leagueSettings={leagueSettings}
                                userCategory={userCategory}
                                isPast={isPast}
                                publicView={publicView}
                            />
                        ))}
                    </div>
                );
            })}
        </>
    );
}

export default function SchedulePage() {
    const { userCategory, isRegistered } = useAuth();
    const racesQuery = useRacesQuery();
    const settingsQuery = useLeagueSettingsQuery();
    const stageRacesQuery = useStageRacesQuery();
    const [debugMode, setDebugMode] = useState(false);
    const [debugLogs, setDebugLogs] = useState<string[]>([]);
    const publicView = !isRegistered;

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        setDebugMode(params.get('debug') === '1');
    }, []);

    useEffect(() => {
        if (!debugMode) return;

        const append = (line: string) => {
            setDebugLogs((prev) => {
                const next = [...prev, `${new Date().toISOString()} ${line}`];
                try {
                    sessionStorage.setItem('__schedule_debug_logs', JSON.stringify(next.slice(-30)));
                } catch {}
                return next.slice(-30);
            });
        };

        append(`[debug] userAgent=${navigator.userAgent}`);
        append(`[debug] timeZone=${Intl.DateTimeFormat().resolvedOptions().timeZone}`);

        const onError = (event: ErrorEvent) => {
            const msg = event.message || 'Unknown runtime error';
            const at = event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : 'unknown-location';
            const stack = event.error?.stack ? ` | ${String(event.error.stack).slice(0, 400)}` : '';
            append(`[error] ${msg} @ ${at}${stack}`);
        };

        const onRejection = (event: PromiseRejectionEvent) => {
            const reason = event.reason instanceof Error
                ? `${event.reason.message} | ${event.reason.stack ?? ''}`
                : JSON.stringify(event.reason);
            append(`[rejection] ${String(reason).slice(0, 500)}`);
        };

        window.addEventListener('error', onError);
        window.addEventListener('unhandledrejection', onRejection);
        return () => {
            window.removeEventListener('error', onError);
            window.removeEventListener('unhandledrejection', onRejection);
        };
    }, [debugMode]);

    const rawRaces = racesQuery.data ?? [];
    const stageRaces = stageRacesQuery.data ?? [];
    const leagueSettings = settingsQuery.data ?? DEFAULT_SETTINGS;

    const allBlocks = useMemo(
        () => buildScheduleBlocks(rawRaces, stageRaces),
        [rawRaces, stageRaces],
    );

    const futureBlocks = useMemo(
        () => filterBlocksByTime(allBlocks, Date.now(), 'future'),
        [allBlocks],
    );
    const pastBlocks = useMemo(() => {
        const blocks = filterBlocksByTime(allBlocks, Date.now(), 'past');
        // Newest event groups first for past
        return [...blocks].reverse();
    }, [allBlocks]);

    const isLoading = racesQuery.isLoading || settingsQuery.isLoading || stageRacesQuery.isLoading;

    if (isLoading) {
        return <div className="p-8 text-center text-muted-foreground">Indlæser kalender...</div>;
    }

    if (debugMode) {
        const invalid = rawRaces.filter((r: Race) => {
            const t = fromTimestamp(r.date)?.getTime();
            return !Number.isFinite(t);
        }).length;
        console.debug(`[schedule] races=${rawRaces.length}, events=${stageRaces.length}, invalidDates=${invalid}`);
    }

    return (
        <div className="max-w-4xl mx-auto px-4 py-8">
            <h1 className="text-3xl font-bold mb-8 text-foreground">Sæsonkalender</h1>
            {debugMode && (
                <div className="mb-6 rounded-lg border border-amber-500/60 bg-amber-50 dark:bg-amber-950/20 p-3">
                    <div className="text-xs font-semibold text-amber-700 dark:text-amber-300 mb-2">
                        Safari debug mode enabled (`?debug=1`)
                    </div>
                    <pre className="text-[11px] leading-4 text-amber-900 dark:text-amber-100 whitespace-pre-wrap break-words max-h-60 overflow-auto">
                        {debugLogs.length > 0 ? debugLogs.join('\n') : 'No debug events captured yet.'}
                    </pre>
                </div>
            )}

            {futureBlocks.length > 0 && (
                <div className="mb-12">
                    <h2 className="text-xl font-semibold mb-6 text-muted-foreground flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-green-500"></span>
                        Kommende løb
                    </h2>
                    <ScheduleBlocks
                        blocks={futureBlocks}
                        leagueSettings={leagueSettings}
                        userCategory={userCategory}
                        publicView={publicView}
                    />
                </div>
            )}

            {pastBlocks.length > 0 && (
                <div>
                    <h2 className="text-xl font-semibold mb-6 text-muted-foreground flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                        Tidligere løb
                    </h2>
                    <ScheduleBlocks
                        blocks={pastBlocks}
                        leagueSettings={leagueSettings}
                        userCategory={userCategory}
                        isPast
                        publicView={publicView}
                    />
                </div>
            )}

            {rawRaces.length === 0 && (
                <div className="text-center py-12 bg-card rounded-lg border border-border">
                    <p className="text-muted-foreground">Ingen planlagte løb endnu.</p>
                </div>
            )}
        </div>
    );
}
