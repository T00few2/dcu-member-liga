'use client';

import { useEffect, useState } from 'react';
import { getZwiftInsiderUrl } from '@/lib/api';
import { formatDateLong, formatTimeWithTz, fromTimestamp } from '@/lib/formatDate';
import PointsSplitBadge from '@/components/races/PointsSplitBadge';
import RouteElevationChart from '@/components/races/RouteElevationChart';
import type { Race, Sprint, EventCategoryConfig, CategoryConfig } from '@/types/live';
import type { LeagueSettings } from '@/types/admin';

interface ProfileSegment {
    name: string;
    type: string;
    fromKm: number;
    toKm: number;
    direction?: string;
}

interface ProfileData {
    leadInDistance: number;
    profileSegments: ProfileSegment[];
}

interface RaceCardProps {
    race: Race;
    leagueSettings: LeagueSettings | null;
    userCategory?: string | null;
    isPast?: boolean;
    showPointsSplit?: boolean;
    variant?: 'full' | 'public';
}

const normalize = (value?: string | null) => (value || '').trim().toLowerCase();
const slugify = (value?: string | null) =>
    normalize(value)
        .replace(/&/g, ' and ')
        .replace(/['"]/g, '')
        .replace(/[^\w\s-]/g, ' ')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

const getZwiftEventUrl = (eventId: string, eventSecret?: string) => {
    if (typeof window === 'undefined') {
        return `https://www.zwift.com/eu/events/view/${eventId}${eventSecret ? `?eventSecret=${eventSecret}` : ''}`;
    }
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;
    const baseUrl = isStandalone ? 'zwift://events/view/' : 'https://www.zwift.com/eu/events/view/';
    return `${baseUrl}${eventId}${eventSecret ? `?eventSecret=${eventSecret}` : ''}`;
};

function normalizeNameForMatch(name?: string): string {
    return (name || '')
        .trim()
        .toLowerCase()
        .replace(/\s+\(.*\)\s*$/g, '')
        .replace(/\s+(reverse|rev\.?)$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeDirectionForMatch(direction?: string, name?: string): 'forward' | 'reverse' {
    if ((direction || '').toLowerCase() === 'reverse') return 'reverse';
    const n = (name || '').toLowerCase();
    if (n.includes('reverse') || n.includes(' rev')) return 'reverse';
    return 'forward';
}

function buildProfileSegmentIndex(profileSegments: ProfileSegment[]): Map<string, ProfileSegment> {
    const counters = new Map<string, number>();
    const index = new Map<string, ProfileSegment>();
    for (const seg of profileSegments) {
        const base = normalizeNameForMatch(seg.name);
        const dir = normalizeDirectionForMatch(seg.direction, seg.name);
        const keyBase = `${base}::${dir}`;
        const count = (counters.get(keyBase) || 0) + 1;
        counters.set(keyBase, count);
        index.set(`${keyBase}::${count}`, seg);
    }
    return index;
}

function SprintsByLap({ sprints, profileData }: { sprints: Sprint[]; profileData: ProfileData | null }) {
    const sprintLabel = (seg: Sprint) => {
        const isReverse = normalize(seg.direction) === 'reverse';
        return isReverse ? `${seg.name} Reverse` : seg.name;
    };

    const profileIndex = profileData ? buildProfileSegmentIndex(profileData.profileSegments) : null;
    const leadIn = profileData?.leadInDistance ?? 0;

    const getKmFromTo = (seg: Sprint): { from: string; to: string } | null => {
        if (!profileIndex) return null;
        const base = normalizeNameForMatch(seg.name);
        const dir = normalizeDirectionForMatch(seg.direction, seg.name);
        const count = Number.isFinite(seg.count) && seg.count > 0 ? seg.count : 1;
        const match = profileIndex.get(`${base}::${dir}::${count}`);
        if (!match) return null;
        return {
            from: (Math.min(match.fromKm, match.toKm) + leadIn).toFixed(1),
            to: (Math.max(match.fromKm, match.toKm) + leadIn).toFixed(1),
        };
    };

    const rows = [...sprints]
        .sort((a, b) => {
            const lapDiff = (a.lap || 1) - (b.lap || 1);
            if (lapDiff !== 0) return lapDiff;
            return a.count - b.count;
        });

    const hasKmData = rows.some((s) => getKmFromTo(s) !== null);

    return (
        <div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                    <thead>
                        <tr className="border-b border-border">
                            <th className="text-left py-1.5 pr-4 font-medium text-muted-foreground text-xs uppercase tracking-wide">Sprint</th>
                            <th className="text-center py-1.5 px-3 font-medium text-muted-foreground text-xs uppercase tracking-wide whitespace-nowrap">Omgang</th>
                            {hasKmData && (
                                <>
                                    <th className="text-right py-1.5 px-3 font-medium text-muted-foreground text-xs uppercase tracking-wide whitespace-nowrap">Fra km</th>
                                    <th className="text-right py-1.5 pl-3 font-medium text-muted-foreground text-xs uppercase tracking-wide whitespace-nowrap">Til km</th>
                                </>
                            )}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((seg, idx) => {
                            const kmFromTo = getKmFromTo(seg);
                            return (
                                <tr key={idx} className="border-b border-border/50 last:border-0">
                                    <td className="py-1.5 pr-4 font-medium text-card-foreground">{sprintLabel(seg)}</td>
                                    <td className="py-1.5 px-3 text-center text-muted-foreground">{seg.lap || 1}</td>
                                    {hasKmData && (
                                        <>
                                            <td className="py-1.5 px-3 text-right font-mono text-card-foreground">
                                                {kmFromTo ? `${kmFromTo.from}` : '—'}
                                            </td>
                                            <td className="py-1.5 pl-3 text-right font-mono text-card-foreground">
                                                {kmFromTo ? `${kmFromTo.to}` : '—'}
                                            </td>
                                        </>
                                    )}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            {hasKmData && leadIn > 0 && (
                <p className="text-xs text-muted-foreground mt-2">
                    Km inkl. indrulning ({leadIn.toFixed(1)} km)
                </p>
            )}
            {hasKmData && leadIn === 0 && (
                <p className="text-xs text-muted-foreground mt-2">
                    Km fra startlinjen inkl. indrulning
                </p>
            )}
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

function getPublicSprints(race: Race): Sprint[] {
    if (race.eventConfiguration?.length) {
        return race.eventConfiguration[0]?.sprints || [];
    }
    if (race.singleModeCategories?.length) {
        return race.singleModeCategories[0]?.sprints || [];
    }
    return race.sprints || [];
}

export default function RaceCard({
    race,
    leagueSettings,
    userCategory,
    isPast = false,
    showPointsSplit = true,
    variant = 'full',
}: RaceCardProps) {
    const raceDate = fromTimestamp(race.date) || new Date(NaN);
    const isPublicVariant = variant === 'public';
    const [profileData, setProfileData] = useState<ProfileData | null>(null);
    const userConfig = race.eventMode === 'multi' ? getUserEventConfig(race, userCategory) : null;
    const userSingleConfig = race.eventMode !== 'multi' ? getUserSingleConfig(race, userCategory) : null;

    const lapsToShow = race.eventMode === 'multi'
        ? (userConfig?.laps || race.laps)
        : (userSingleConfig?.laps || race.laps);

    const sprintsToShow = isPublicVariant
        ? getPublicSprints(race)
        : (
            race.eventMode === 'multi'
                ? ((userConfig?.sprints && userConfig.sprints.length > 0) ? userConfig.sprints : (race.sprints || []))
                : ((userSingleConfig?.sprints && userSingleConfig.sprints.length > 0) ? userSingleConfig.sprints : (race.sprints || []))
        );

    const resolvedSprintsToShow = sprintsToShow.length > 0
        ? sprintsToShow
        : fallbackSprintsFromSelectedKeys(race.selectedSegments);

    useEffect(() => {
        if (!race.map || !race.routeName || resolvedSprintsToShow.length === 0) return;
        const params = new URLSearchParams({ world: race.map, route: race.routeName, laps: String(lapsToShow) });
        fetch(`/api/route-elevation?${params}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((json) => {
                if (!json) return;
                setProfileData({
                    leadInDistance: Number(json.leadInDistance) || 0,
                    profileSegments: Array.isArray(json.profileSegments) ? json.profileSegments : [],
                });
            })
            .catch(() => {});
    }, [race.map, race.routeName, lapsToShow, resolvedSprintsToShow.length]);

    const racePassHref = race.eventMode === 'multi'
        ? (userConfig?.eventId ? getZwiftEventUrl(userConfig.eventId, userConfig.eventSecret) : null)
        : (race.eventId ? getZwiftEventUrl(race.eventId, race.eventSecret) : null);

    return (
        <div className={`bg-card border border-border rounded-lg shadow-sm overflow-hidden mb-6 ${isPast ? 'opacity-75' : ''}`}>
            <div className={isPublicVariant ? 'p-4 md:p-5' : 'p-6'}>
                <div className={`flex flex-col md:flex-row justify-between md:items-start gap-4 ${isPublicVariant ? 'mb-3' : 'mb-4'}`}>
                    <div>
                        <div className="text-sm font-medium text-primary mb-1">
                            {formatDateLong(raceDate)}
                        </div>
                        <h3 className={isPublicVariant ? 'text-xl font-bold text-card-foreground' : 'text-2xl font-bold text-card-foreground'}>{race.name}</h3>
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
                                (ZI ↗)
                            </a>
                        </div>
                    </div>
                </div>

                <div className={`grid grid-cols-3 gap-4 ${isPublicVariant ? 'mb-4' : 'mb-6'} text-sm`}>
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

                {race.map && race.routeName && (
                    <div className={`border-t border-border pt-4 ${isPublicVariant ? 'mb-4' : 'mb-6'}`}>
                        <div className="flex items-center justify-between gap-3 mb-2">
                            <h4 className="text-sm font-semibold text-card-foreground">Ruteprofil</h4>
                            {resolvedSprintsToShow.length > 0 && (
                                <span className="text-xs text-muted-foreground">
                                    <span className="text-amber-600 mr-1">★</span>
                                    Pointspurt
                                </span>
                            )}
                        </div>
                        <RouteElevationChart
                            worldName={race.map}
                            routeName={race.routeName}
                            laps={lapsToShow}
                            pointSegments={resolvedSprintsToShow}
                        />
                    </div>
                )}

                {!isPublicVariant && !isPast && showPointsSplit && leagueSettings && (
                    <div className="border-t border-border pt-4 mb-6">
                        <h4 className="text-sm font-semibold text-card-foreground mb-2">Pointfordeling</h4>
                        <PointsSplitBadge
                            race={race}
                            finishPoints={leagueSettings.finishPoints || []}
                            sprintPoints={leagueSettings.sprintPoints || []}
                        />
                    </div>
                )}

                {!isPublicVariant && resolvedSprintsToShow.length > 0 && (
                    <div className="border-t border-border pt-4 mb-6">
                        <h4 className="text-sm font-semibold text-card-foreground mb-3">Pointsprint</h4>
                        <SprintsByLap sprints={resolvedSprintsToShow} profileData={profileData} />
                    </div>
                )}

                {!isPublicVariant && racePassHref ? (
                    <a
                        href={racePassHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block w-full bg-primary hover:bg-primary-dark text-white font-bold py-3 px-4 rounded-lg text-center transition shadow-md flex items-center justify-center gap-2"
                    >
                        <span>Løbspas</span>
                        <ExternalLinkIcon size={16} />
                    </a>
                ) : !isPublicVariant ? (
                    <div
                        className="block w-full bg-muted text-muted-foreground font-bold py-3 px-4 rounded-lg text-center shadow-sm cursor-not-allowed"
                        title="Løbspas kommer snart - hold øje"
                    >
                        Løbspas kommer snart
                    </div>
                ) : null}
            </div>
        </div>
    );
}

