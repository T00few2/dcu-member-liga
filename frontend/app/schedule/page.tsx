'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import type { Race } from '@/types/live';
import type { LeagueSettings } from '@/types/admin';
import { API_URL } from '@/lib/api';
import { fromTimestamp } from '@/lib/formatDate';
import RaceCard from '@/components/races/RaceCard';

export default function SchedulePage() {
    const searchParams = useSearchParams();
    const debugMode = searchParams.get('debug') === '1';
    const { user, userCategory, loading: authLoading, isRegistered } = useAuth();
    const [races, setRaces] = useState<Race[]>([]);
    const [debugLogs, setDebugLogs] = useState<string[]>([]);
    const [leagueSettings, setLeagueSettings] = useState<LeagueSettings>({
        finishPoints: [],
        sprintPoints: [],
        leagueRankPoints: [],
        bestRacesCount: 5,
    });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!debugMode) return;

        const append = (line: string) => {
            setDebugLogs((prev) => {
                const next = [...prev, `${new Date().toISOString()} ${line}`];
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

    useEffect(() => {
        const fetchRaces = async () => {
            if (!user) return;
            try {
                const token = await user.getIdToken();
                const [racesRes, settingsRes] = await Promise.all([
                    fetch(`${API_URL}/races`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    }),
                    fetch(`${API_URL}/league/settings`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    }),
                ]);

                if (racesRes.ok) {
                    const data = await racesRes.json();
                    // Sort by date ascending
                    const sorted = (data.races || []).sort((a: Race, b: Race) => {
                        const aTime = fromTimestamp(a.date)?.getTime() ?? Number.POSITIVE_INFINITY;
                        const bTime = fromTimestamp(b.date)?.getTime() ?? Number.POSITIVE_INFINITY;
                        return aTime - bTime;
                    });
                    setRaces(sorted);
                    if (debugMode) {
                        const invalid = (data.races || []).filter((r: Race) => {
                            const t = fromTimestamp(r.date)?.getTime();
                            return !Number.isFinite(t);
                        }).length;
                        setDebugLogs((prev) => [...prev, `${new Date().toISOString()} [debug] races=${(data.races || []).length}, invalidDates=${invalid}`].slice(-30));
                    }
                }

                if (settingsRes.ok) {
                    const settingsData = await settingsRes.json();
                    const settings = settingsData.settings || {};
                    setLeagueSettings({
                        name: settings.name || '',
                        finishPoints: settings.finishPoints || [],
                        sprintPoints: settings.sprintPoints || [],
                        leagueRankPoints: settings.leagueRankPoints || [],
                        bestRacesCount: settings.bestRacesCount || 5,
                    });
                }
            } catch (e) {
                console.error('Error fetching races', e);
                if (debugMode) {
                    const msg = e instanceof Error ? `${e.message} | ${e.stack ?? ''}` : JSON.stringify(e);
                    setDebugLogs((prev) => [...prev, `${new Date().toISOString()} [fetch-error] ${String(msg).slice(0, 500)}`].slice(-30));
                }
            } finally {
                setLoading(false);
            }
        };

        if (user && isRegistered) {
            fetchRaces();
        }
    }, [user, isRegistered]);

    if (authLoading || loading) {
        return <div className="p-8 text-center text-muted-foreground">Indlæser kalender...</div>;
    }

    if (!isRegistered) return null;

    const now = Date.now();
    const futureRaces = races.filter((r) => {
        const t = fromTimestamp(r.date)?.getTime();
        return Number.isFinite(t) && (t as number) > now;
    });
    const pastRaces = races.filter((r) => {
        const t = fromTimestamp(r.date)?.getTime();
        return Number.isFinite(t) && (t as number) <= now;
    }).reverse();

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

            {races.length === 0 && (
                <div className="text-center py-12 bg-card rounded-lg border border-border">
                    <p className="text-muted-foreground">Ingen planlagte løb endnu.</p>
                </div>
            )}
        </div>
    );
}
