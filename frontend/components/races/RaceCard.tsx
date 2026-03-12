'use client';

import { getZwiftInsiderUrl } from '@/lib/api';
import { formatDateLong, formatTimeWithTz } from '@/lib/formatDate';
import PointsSplitBadge from '@/components/races/PointsSplitBadge';
import type { Race, Sprint, EventCategoryConfig, CategoryConfig } from '@/types/live';
import type { LeagueSettings } from '@/types/admin';

interface RaceCardProps {
    race: Race;
    leagueSettings: LeagueSettings | null;
    userCategory?: string | null;
    isPast?: boolean;
    showPointsSplit?: boolean;
}

const normalize = (value?: string | null) => (value || '').trim().toLowerCase();

const getZwiftEventUrl = (eventId: string, eventSecret?: string) => {
    if (typeof window === 'undefined') {
        return `https://www.zwift.com/eu/events/view/${eventId}${eventSecret ? `?eventSecret=${eventSecret}` : ''}`;
    }
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;
    const baseUrl = isStandalone ? 'zwift://events/view/' : 'https://www.zwift.com/eu/events/view/';
    return `${baseUrl}${eventId}${eventSecret ? `?eventSecret=${eventSecret}` : ''}`;
};

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

function ExternalLinkIcon({ size }: { size: number }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
        </svg>
    );
}

function getUserEventConfig(race: Race, userCategory?: string | null): EventCategoryConfig | null {
    if (!race.eventConfiguration || race.eventConfiguration.length === 0) return null;
    if (!userCategory) return null;
    const wanted = normalize(userCategory);
    return race.eventConfiguration.find(c => normalize(c.customCategory) === wanted) || null;
}

function getUserSingleConfig(race: Race, userCategory?: string | null): CategoryConfig | null {
    if (!race.singleModeCategories || race.singleModeCategories.length === 0) return null;
    if (!userCategory) return null;
    const wanted = normalize(userCategory);
    return race.singleModeCategories.find(c => normalize(c.category) === wanted) || null;
}

function fallbackSprintsFromSelectedKeys(selectedSegments?: string[]): Sprint[] {
    return (selectedSegments || [])
        .map((key) => {
            const [idPart, countPart] = key.split('_');
            const count = Number.parseInt(countPart || '1', 10);
            const safeCount = Number.isFinite(count) ? count : 1;
            return {
                id: idPart || key,
                name: `Segment ${idPart || key}`,
                key,
                count: safeCount,
                lap: 1,
            } satisfies Sprint;
        });
}

export default function RaceCard({
    race,
    leagueSettings,
    userCategory,
    isPast = false,
    showPointsSplit = true,
}: RaceCardProps) {
    const raceDate = new Date(race.date);
    const userConfig = race.eventMode === 'multi' ? getUserEventConfig(race, userCategory) : null;
    const userSingleConfig = race.eventMode !== 'multi' ? getUserSingleConfig(race, userCategory) : null;

    const lapsToShow = race.eventMode === 'multi'
        ? (userConfig?.laps || race.laps)
        : (userSingleConfig?.laps || race.laps);

    const sprintsToShow = race.eventMode === 'multi'
        ? ((userConfig?.sprints && userConfig.sprints.length > 0) ? userConfig.sprints : (race.sprints || []))
        : (userSingleConfig?.sprints || race.sprints || []);

    const resolvedSprintsToShow = sprintsToShow.length > 0
        ? sprintsToShow
        : fallbackSprintsFromSelectedKeys(race.selectedSegments);

    const racePassHref = race.eventMode === 'multi'
        ? (userConfig?.eventId ? getZwiftEventUrl(userConfig.eventId, userConfig.eventSecret) : null)
        : (race.eventId ? getZwiftEventUrl(race.eventId, race.eventSecret) : null);

    return (
        <div className={`bg-card border border-border rounded-lg shadow-sm overflow-hidden mb-6 ${isPast ? 'opacity-75' : ''}`}>
            <div className="p-6">
                <div className="flex flex-col md:flex-row justify-between md:items-start gap-4 mb-4">
                    <div>
                        <div className="text-sm font-medium text-primary mb-1">
                            {formatDateLong(raceDate)}
                        </div>
                        <h3 className="text-2xl font-bold text-card-foreground">{race.name}</h3>
                        <div className="text-muted-foreground text-sm mt-1">
                            Start: {formatTimeWithTz(raceDate)}
                        </div>
                    </div>
                    <div className="bg-muted/30 px-4 py-2 rounded-lg text-right">
                        <div className="font-semibold text-card-foreground">{race.map}</div>
                        <div className="text-sm text-muted-foreground flex items-center justify-end gap-1">
                            {race.routeName}
                            <a
                                href={getZwiftInsiderUrl(race.routeName ?? '')}
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
                        <div className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Højdemeter</div>
                        <div className="font-semibold text-card-foreground">{race.totalElevation} m</div>
                    </div>
                    <div className="bg-muted/20 p-3 rounded text-center flex flex-col justify-center">
                        <div className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Omgange</div>
                        <div className="font-semibold text-card-foreground flex justify-center items-center h-full">
                            {lapsToShow}
                        </div>
                    </div>
                </div>

                {!isPast && showPointsSplit && leagueSettings && (
                    <div className="border-t border-border pt-4 mb-6">
                        <h4 className="text-sm font-semibold text-card-foreground mb-2">Pointfordeling</h4>
                        <PointsSplitBadge
                            race={race}
                            finishPoints={leagueSettings.finishPoints || []}
                            sprintPoints={leagueSettings.sprintPoints || []}
                        />
                    </div>
                )}

                {resolvedSprintsToShow.length > 0 && (
                    <div className="border-t border-border pt-4 mb-6">
                        <h4 className="text-sm font-semibold text-card-foreground mb-3">Pointsprint</h4>
                        <SprintsByLap sprints={resolvedSprintsToShow} />
                    </div>
                )}

                {racePassHref ? (
                    <a
                        href={racePassHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block w-full bg-primary hover:bg-primary-dark text-white font-bold py-3 px-4 rounded-lg text-center transition shadow-md flex items-center justify-center gap-2"
                    >
                        <span>Løbspas</span>
                        <ExternalLinkIcon size={16} />
                    </a>
                ) : (
                    <div
                        className="block w-full bg-muted text-muted-foreground font-bold py-3 px-4 rounded-lg text-center shadow-sm cursor-not-allowed"
                        title="Løbspas kommer snart - hold øje"
                    >
                        Løbspas kommer snart
                    </div>
                )}
            </div>
        </div>
    );
}

