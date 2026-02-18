'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';

interface Segment {
    id: string;
    name: string;
    count: number;
    direction: string;
    lap: number;
    key?: string;
}

interface Race {
    id: string;
    name: string;
    date: string;
    routeId: string;
    routeName: string;
    map: string;
    laps: number;
    totalDistance: number;
    totalElevation: number;
    sprints?: Segment[];
    eventMode?: 'single' | 'multi';
    eventConfiguration?: {
        customCategory: string;
        laps?: number;
        sprints?: Segment[];
        eventId: string;
        eventSecret?: string;
    }[];
    eventId?: string; // Legacy/Single
    eventSecret?: string; // Legacy/Single
}

const getZwiftInsiderUrl = (routeName: string) => {
    if (!routeName) return '#';
    const slug = routeName.toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\w\-]+/g, '')
        .replace(/\-\-+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '');
    return `https://zwiftinsider.com/route/${slug}/`;
};

const getZwiftEventUrl = (eventId: string, eventSecret?: string) => {
    if (typeof window === 'undefined') return `https://www.zwift.com/eu/events/view/${eventId}${eventSecret ? `?eventSecret=${eventSecret}` : ''}`;

    // Check if we are in PWA standalone mode
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;

    const baseUrl = isStandalone ? 'zwift://events/view/' : 'https://www.zwift.com/eu/events/view/';
    return `${baseUrl}${eventId}${eventSecret ? `?eventSecret=${eventSecret}` : ''}`;
};

export default function SchedulePage() {
    const { user, loading: authLoading, isRegistered } = useAuth();
    const router = useRouter();
    const [races, setRaces] = useState<Race[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!authLoading) {
            if (!user) {
                router.push('/');
            } else if (!isRegistered) {
                router.push('/register');
            }
        }
    }, [user, authLoading, isRegistered, router]);

    useEffect(() => {
        const fetchRaces = async () => {
            if (!user) return;
            try {
                const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
                const token = await user.getIdToken();
                const res = await fetch(`${apiUrl}/races`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    // Sort by date ascending
                    const sorted = (data.races || []).sort((a: Race, b: Race) =>
                        new Date(a.date).getTime() - new Date(b.date).getTime()
                    );
                    setRaces(sorted);
                }
            } catch (e) {
                console.error('Error fetching races', e);
            } finally {
                setLoading(false);
            }
        };

        if (user && isRegistered) {
            fetchRaces();
        }
    }, [user, isRegistered]);

    if (authLoading || loading) {
        return <div className="p-8 text-center text-muted-foreground">Loading schedule...</div>;
    }

    if (!isRegistered) return null;

    const futureRaces = races.filter(r => new Date(r.date) > new Date());
    const pastRaces = races.filter(r => new Date(r.date) <= new Date()).reverse();

    const RaceCard = ({ race, isPast = false }: { race: Race, isPast?: boolean }) => {
        const raceDate = new Date(race.date);

        // Determine Laps Display
        let lapsDisplay = <>{race.laps}</>;
        if (race.eventMode === 'multi' && race.eventConfiguration) {
            const uniqueLaps = Array.from(new Set(race.eventConfiguration.map(c => c.laps || race.laps)));
            if (uniqueLaps.length > 1) {
                lapsDisplay = (
                    <div className="flex flex-col text-xs">
                        {race.eventConfiguration.map(c => (
                            <span key={c.customCategory}>{c.customCategory}: {c.laps || race.laps}</span>
                        ))}
                    </div>
                );
            } else if (uniqueLaps.length === 1 && uniqueLaps[0] !== race.laps) {
                lapsDisplay = <>{uniqueLaps[0]}</>;
            }
        }

        // Determine Sprints Display
        let sprintsContent = null;
        if (race.eventMode === 'multi' && race.eventConfiguration) {
            // Multi-Category Sprints
            sprintsContent = (
                <div className="space-y-4">
                    {race.eventConfiguration.map((config, idx) => {
                        const catSprints = config.sprints || [];
                        if (catSprints.length === 0) return null;

                        const sprintsByLap = catSprints.reduce((acc, seg) => {
                            const lap = seg.lap || 1;
                            if (!acc[lap]) acc[lap] = [];
                            acc[lap].push(seg);
                            return acc;
                        }, {} as Record<number, Segment[]>);

                        return (
                            <div key={idx} className="text-sm">
                                <div className="font-semibold text-xs uppercase text-muted-foreground mb-2 border-b border-border pb-1">
                                    {config.customCategory}
                                </div>
                                <div className="space-y-2">
                                    {Object.keys(sprintsByLap).sort((a, b) => parseInt(a) - parseInt(b)).map(lapKey => {
                                        const lapNum = parseInt(lapKey);
                                        return (
                                            <div key={lapNum} className="flex flex-col sm:flex-row gap-2 sm:gap-4 text-xs">
                                                <div className="w-12 font-medium text-muted-foreground shrink-0">Lap {lapNum}</div>
                                                <div className="flex-1 flex flex-wrap gap-2">
                                                    {sprintsByLap[lapNum].sort((a, b) => a.count - b.count).map((seg, sIdx) => (
                                                        <span key={sIdx} className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-secondary text-secondary-foreground border border-border">
                                                            {seg.name}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            );
        } else if (race.sprints && race.sprints.length > 0) {
            // Single Mode / Legacy Sprints
            const sprintsByLap = race.sprints.reduce((acc, seg) => {
                const lap = seg.lap || 1;
                if (!acc[lap]) acc[lap] = [];
                acc[lap].push(seg);
                return acc;
            }, {} as Record<number, Segment[]>);

            sprintsContent = (
                <div className="space-y-3">
                    {Object.keys(sprintsByLap).sort((a, b) => parseInt(a) - parseInt(b)).map(lapKey => {
                        const lapNum = parseInt(lapKey);
                        return (
                            <div key={lapNum} className="flex flex-col sm:flex-row gap-2 sm:gap-8 text-sm">
                                <div className="w-16 font-medium text-muted-foreground shrink-0">Lap {lapNum}</div>
                                <div className="flex-1 flex flex-wrap gap-2">
                                    {sprintsByLap[lapNum].sort((a, b) => a.count - b.count).map((seg, idx) => (
                                        <span key={idx} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                                            {seg.name}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            );
        }

        return (
            <div className={`bg-card border border-border rounded-lg shadow-sm overflow-hidden mb-6 ${isPast ? 'opacity-75' : ''}`}>
                <div className="p-6">
                    <div className="flex flex-col md:flex-row justify-between md:items-start gap-4 mb-4">
                        <div>
                            <div className="text-sm font-medium text-primary mb-1">
                                {raceDate.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                            </div>
                            <h3 className="text-2xl font-bold text-card-foreground">{race.name}</h3>
                            <div className="text-muted-foreground text-sm mt-1">
                                Start: {raceDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                            </div>
                            {race.eventMode === 'multi' ? (
                                <div className="flex flex-wrap gap-2 mt-2">
                                    {race.eventConfiguration?.map((config, i) => (
                                        <a
                                            key={i}
                                            href={getZwiftEventUrl(config.eventId, config.eventSecret)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-xs bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20 px-2 py-1 rounded hover:bg-orange-500/20 transition-colors"
                                        >
                                            Event: {config.customCategory} ↗
                                        </a>
                                    ))}
                                </div>
                            ) : (
                                race.eventId && (
                                    <a
                                        href={getZwiftEventUrl(race.eventId, race.eventSecret)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-block mt-2 text-xs bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20 px-2 py-1 rounded hover:bg-orange-500/20 transition-colors"
                                    >
                                        View Event on Zwift ↗
                                    </a>
                                )
                            )}
                        </div>
                        <div className="bg-muted/30 px-4 py-2 rounded-lg text-right">
                            <div className="font-semibold text-card-foreground">{race.map}</div>
                            <div className="text-sm text-muted-foreground flex items-center justify-end gap-1">
                                {race.routeName}
                                <a
                                    href={getZwiftInsiderUrl(race.routeName)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-primary hover:underline"
                                    title="View on ZwiftInsider"
                                >
                                    (Info ↗)
                                </a>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4 mb-6 text-sm">
                        <div className="bg-muted/20 p-3 rounded text-center">
                            <div className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Distance</div>
                            <div className="font-semibold text-card-foreground">{race.totalDistance} km</div>
                        </div>
                        <div className="bg-muted/20 p-3 rounded text-center">
                            <div className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Elevation</div>
                            <div className="font-semibold text-card-foreground">{race.totalElevation} m</div>
                        </div>
                        <div className="bg-muted/20 p-3 rounded text-center flex flex-col justify-center">
                            <div className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Laps</div>
                            <div className="font-semibold text-card-foreground flex justify-center items-center h-full">
                                {lapsDisplay}
                            </div>
                        </div>
                    </div>

                    {sprintsContent && (
                        <div className="border-t border-border pt-4">
                            <h4 className="text-sm font-semibold text-card-foreground mb-3">Points Sprints</h4>
                            {sprintsContent}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="max-w-4xl mx-auto px-4 py-8">
            <h1 className="text-3xl font-bold mb-8 text-foreground">League Schedule</h1>

            {futureRaces.length > 0 && (
                <div className="mb-12">
                    <h2 className="text-xl font-semibold mb-6 text-muted-foreground flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-green-500"></span>
                        Upcoming Races
                    </h2>
                    {futureRaces.map(race => (
                        <RaceCard key={race.id} race={race} />
                    ))}
                </div>
            )}

            {pastRaces.length > 0 && (
                <div>
                    <h2 className="text-xl font-semibold mb-6 text-muted-foreground flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                        Past Races
                    </h2>
                    {pastRaces.map(race => (
                        <RaceCard key={race.id} race={race} isPast={true} />
                    ))}
                </div>
            )}

            {races.length === 0 && (
                <div className="text-center py-12 bg-card rounded-lg border border-border">
                    <p className="text-muted-foreground">No races scheduled yet.</p>
                </div>
            )}
        </div>
    );
}
