'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRacesQuery, useLeagueSettingsQuery } from '@/hooks/queries';
import type { Race } from '@/types/live';
import { fromTimestamp } from '@/lib/formatDate';
import RaceCard from '@/components/races/RaceCard';

const DEFAULT_SETTINGS = {
    finishPoints: [] as number[],
    sprintPoints: [] as number[],
    leagueRankPoints: [] as number[],
    bestRacesCount: 5,
};

export default function SchedulePage() {
    const { user, userCategory, loading: authLoading, isRegistered } = useAuth();
    const racesQuery = useRacesQuery();
    const settingsQuery = useLeagueSettingsQuery();
    const [debugMode, setDebugMode] = useState(false);
    const [debugLogs, setDebugLogs] = useState<string[]>([]);

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

    const isLoading = authLoading || racesQuery.isLoading || settingsQuery.isLoading;

    if (isLoading) {
        return <div className="p-8 text-center text-muted-foreground">Indlæser kalender...</div>;
    }

    if (!isRegistered) return null;

    const rawRaces = racesQuery.data ?? [];
    const leagueSettings = settingsQuery.data ?? DEFAULT_SETTINGS;

    const now = Date.now();
    const sorted = [...rawRaces].sort((a: Race, b: Race) => {
        const aTime = fromTimestamp(a.date)?.getTime() ?? Number.POSITIVE_INFINITY;
        const bTime = fromTimestamp(b.date)?.getTime() ?? Number.POSITIVE_INFINITY;
        return aTime - bTime;
    });
    const futureRaces = sorted.filter((r) => {
        const t = fromTimestamp(r.date)?.getTime();
        return Number.isFinite(t) && (t as number) > now;
    });
    const pastRaces = sorted.filter((r) => {
        const t = fromTimestamp(r.date)?.getTime();
        return Number.isFinite(t) && (t as number) <= now;
    }).reverse();

    if (debugMode) {
        const invalid = rawRaces.filter((r: Race) => {
            const t = fromTimestamp(r.date)?.getTime();
            return !Number.isFinite(t);
        }).length;
        console.debug(`[schedule] races=${rawRaces.length}, invalidDates=${invalid}`);
    }

    return (
        <div className="max-w-4xl mx-auto px-4 py-8">
            <h1 className="text-3xl font-bold mb-8 text-foreground">Ligakalender</h1>
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

            {futureRaces.length > 0 && (
                <div className="mb-12">
                    <h2 className="text-xl font-semibold mb-6 text-muted-foreground flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-green-500"></span>
                        Kommende løb
                    </h2>
                    {futureRaces.map(race => (
                        <RaceCard
                            key={race.id}
                            race={race}
                            leagueSettings={leagueSettings}
                            userCategory={userCategory}
                        />
                    ))}
                </div>
            )}

            {pastRaces.length > 0 && (
                <div>
                    <h2 className="text-xl font-semibold mb-6 text-muted-foreground flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                        Tidligere løb
                    </h2>
                    {pastRaces.map(race => (
                        <RaceCard
                            key={race.id}
                            race={race}
                            leagueSettings={leagueSettings}
                            userCategory={userCategory}
                            isPast={true}
                            showPointsSplit={false}
                        />
                    ))}
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
