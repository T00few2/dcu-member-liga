'use client';

import Link from 'next/link';
import { getZwiftMapUrl } from '@/lib/api';
import type { Race, Sprint } from '@/types/live';

interface NextRaceCardProps {
    race: Race;
}

function SprintsByLap({ sprints }: { sprints: Sprint[] }) {
    const byLap = sprints.reduce((acc, seg) => {
        const lap = seg.lap || 1;
        if (!acc[lap]) acc[lap] = [];
        acc[lap].push(seg);
        return acc;
    }, {} as Record<number, Sprint[]>);

    return (
        <div className="space-y-3">
            {Object.entries(byLap)
                .sort(([a], [b]) => parseInt(a) - parseInt(b))
                .map(([lapKey, segs]) => (
                    <div key={lapKey} className="flex flex-col sm:flex-row gap-2 sm:gap-8 text-sm">
                        <div className="w-16 font-medium text-muted-foreground shrink-0">Omgang {lapKey}</div>
                        <div className="flex-1 flex flex-wrap gap-2">
                            {segs.sort((a, b) => a.count - b.count).map((seg, idx) => (
                                <span key={idx} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                                    {seg.name}
                                </span>
                            ))}
                        </div>
                    </div>
                ))}
        </div>
    );
}

function MultiCategorySprintDisplay({ race }: { race: Race }) {
    if (!race.eventConfiguration) return null;
    return (
        <div className="space-y-4">
            {race.eventConfiguration.map((config, idx) => {
                const catSprints = config.sprints || [];
                if (catSprints.length === 0) return null;
                const byLap = catSprints.reduce((acc, seg) => {
                    const lap = seg.lap || 1;
                    if (!acc[lap]) acc[lap] = [];
                    acc[lap].push(seg);
                    return acc;
                }, {} as Record<number, Sprint[]>);
                return (
                    <div key={idx} className="text-sm">
                        <div className="font-semibold text-xs uppercase text-muted-foreground mb-2 border-b border-border pb-1">
                            {config.customCategory}
                        </div>
                        <div className="space-y-2">
                            {Object.keys(byLap).sort((a, b) => parseInt(a) - parseInt(b)).map(lapKey => (
                                <div key={lapKey} className="flex flex-col sm:flex-row gap-2 sm:gap-4 text-xs">
                                    <div className="w-12 font-medium text-muted-foreground shrink-0">Omgang {lapKey}</div>
                                    <div className="flex-1 flex flex-wrap gap-2">
                                        {byLap[parseInt(lapKey)].sort((a, b) => a.count - b.count).map((seg, sIdx) => (
                                            <span key={sIdx} className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-secondary text-secondary-foreground border border-border">
                                                {seg.name}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function LapsDisplay({ race }: { race: Race }) {
    if (race.eventMode === 'multi' && race.eventConfiguration) {
        const uniqueLaps = Array.from(new Set(race.eventConfiguration.map(c => c.laps || race.laps)));
        if (uniqueLaps.length > 1) {
            return (
                <div className="flex flex-col text-xs">
                    {race.eventConfiguration.map(c => (
                        <span key={c.customCategory}>{c.customCategory}: {c.laps || race.laps}</span>
                    ))}
                </div>
            );
        }
        if (uniqueLaps.length === 1 && uniqueLaps[0] !== race.laps) {
            return <>{uniqueLaps[0]}</>;
        }
    }
    return <>{race.laps}</>;
}

function ZwiftEventLinks({ race }: { race: Race }) {
    if (race.eventMode === 'multi') {
        return (
            <div className="flex flex-col gap-2">
                {race.eventConfiguration?.map((config, i) => (
                    <a
                        key={i}
                        href={`https://www.zwift.com/eu/events/view/${config.eventId}${config.eventSecret ? `?eventSecret=${config.eventSecret}` : ''}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block w-full bg-primary hover:bg-primary-dark text-white font-bold py-2 px-4 rounded-lg text-center transition shadow-md flex items-center justify-center gap-2 text-sm"
                    >
                        <span>Løbspas: {config.customCategory}</span>
                        <ExternalLinkIcon size={14} />
                    </a>
                ))}
            </div>
        );
    }
    if (!race.eventId) return null;
    return (
        <a
            href={`https://www.zwift.com/eu/events/view/${race.eventId}${race.eventSecret ? `?eventSecret=${race.eventSecret}` : ''}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full bg-primary hover:bg-primary-dark text-white font-bold py-3 px-4 rounded-lg text-center transition shadow-md flex items-center justify-center gap-2"
        >
            <span>Løbspas</span>
            <ExternalLinkIcon size={16} />
        </a>
    );
}

function ExternalLinkIcon({ size }: { size: number }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
        </svg>
    );
}

export default function NextRaceCard({ race }: NextRaceCardProps) {
    const hasMultiSprints = race.eventMode === 'multi' && race.eventConfiguration?.some(c => (c.sprints || []).length > 0);
    const hasSingleSprints = race.sprints && race.sprints.length > 0;

    return (
        <div>
            <div className="flex justify-between items-end mb-2">
                <div className="text-primary text-sm font-bold uppercase tracking-wider">Næste Løb</div>
                <Link href="/schedule" className="text-sm text-primary hover:underline">
                    Se hele løbskalenderen &rarr;
                </Link>
            </div>
            <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden p-6 text-left">
                <div className="flex flex-col md:flex-row justify-between md:items-start gap-4 mb-4">
                    <div>
                        <div className="text-sm font-medium text-primary mb-1">
                            {new Date(race.date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                        </div>
                        <h3 className="text-2xl font-bold text-card-foreground">{race.name}</h3>
                        <div className="text-muted-foreground text-sm mt-1">
                            Start: {new Date(race.date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                        </div>
                    </div>
                    <div className="bg-muted/30 px-4 py-2 rounded-lg text-right">
                        <div className="font-semibold text-card-foreground">{race.map}</div>
                        <div className="text-sm text-muted-foreground flex items-center justify-end gap-1">
                            {race.routeName}
                            <a
                                href={getZwiftMapUrl(race.map ?? '', race.routeName ?? '')}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-primary hover:underline"
                                title="View on ZwiftMap"
                            >
                                (ZwiftMap ↗)
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
                        <div className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Højdemeter</div>
                        <div className="font-semibold text-card-foreground">{race.totalElevation} m</div>
                    </div>
                    <div className="bg-muted/20 p-3 rounded text-center flex flex-col justify-center">
                        <div className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Omgange</div>
                        <div className="font-semibold text-card-foreground flex justify-center items-center h-full">
                            <LapsDisplay race={race} />
                        </div>
                    </div>
                </div>

                {(hasMultiSprints || hasSingleSprints) && (
                    <div className="border-t border-border pt-4 mb-6">
                        <h4 className="text-sm font-semibold text-card-foreground mb-3">Pointsprint</h4>
                        {hasMultiSprints
                            ? <MultiCategorySprintDisplay race={race} />
                            : <SprintsByLap sprints={race.sprints!} />
                        }
                    </div>
                )}

                <ZwiftEventLinks race={race} />
            </div>
        </div>
    );
}
