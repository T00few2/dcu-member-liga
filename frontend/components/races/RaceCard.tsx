'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { getZwiftInsiderUrl, API_URL } from '@/lib/api';
import { formatDateLong, formatDateShort, formatTimeWithTz, fromTimestamp } from '@/lib/formatDate';
import ConfirmUnsignupModal from '@/components/races/ConfirmUnsignupModal';
import PointsSplitBadge from '@/components/races/PointsSplitBadge';
import RouteElevationChart from '@/components/races/RouteElevationChart';
import SprintsByLap, {
    normalizeSprintDirectionForMatch as normalizeDirectionForMatch,
    type SprintsByLapProfileData as ProfileData,
} from '@/components/races/SprintsByLap';
import type { Race, Sprint, EventCategoryConfig, CategoryConfig } from '@/types/live';
import type { LeagueSettings, RaceGroup } from '@/types/admin';
import { useRouteElevationQuery, useRaceSegmentsQuery, useMyRaceSignupsQuery, useRaceSignupCountsQuery } from '@/hooks/queries';
import { useAuth } from '@/lib/auth-context';
import { scaleRaceDistanceKm } from '@/hooks/useLeagueData';
import { formatOmgangeDisplay } from '@/lib/raceLaps';
import { mergeLapBannerProfileSegments } from '@/lib/routeProfileSegments';

interface EventSegmentInstance {
    id: string;
    count: number;
    direction?: string;
    lap?: number;
}

interface RaceCardProps {
    race: Race;
    leagueSettings: LeagueSettings | null;
    userCategory?: string | null;
    isPast?: boolean;
    showPointsSplit?: boolean;
    variant?: 'full' | 'public';
    /** Season event context (Phase C) */
    eventName?: string | null;
    seasonClassLabel?: string | null;
    stageLabel?: string | null;
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
    const secret = eventSecret ? `?eventSecret=${eventSecret}` : '';
    return `https://www.zwift.com/events/view/${eventId}${secret}`;
};

function ExternalLinkIcon({ size }: { size: number }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
        </svg>
    );
}

function CheckIcon({ size }: { size: number }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="20 6 9 17 4 12"></polyline>
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

function getUserGroupConfig(race: Race, userCategory?: string | null): RaceGroup | null {
    if (!race.raceGroups || race.raceGroups.length === 0) return null;
    if (!userCategory) return race.raceGroups[0] || null;
    const wanted = normalize(userCategory);
    return race.raceGroups.find(g =>
        g.categories.some(c => normalize(c.category) === wanted)
    ) || null;
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
    if (race.eventMode === 'grouped' && race.raceGroups?.length) {
        return race.raceGroups[0]?.sprints || [];
    }
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
    eventName,
    seasonClassLabel,
    stageLabel,
}: RaceCardProps) {
    const raceDate = fromTimestamp(race.date) || new Date(NaN);
    const isPublicVariant = variant === 'public';
    const { user, isRegistered } = useAuth();
    const queryClient = useQueryClient();
    const mySignupsQuery = useMyRaceSignupsQuery();
    const signupCountsQuery = useRaceSignupCountsQuery();
    const persistedStatus = mySignupsQuery.data?.[race.id]?.status;
    const signupCount = signupCountsQuery.data?.[race.id] ?? 0;
    const [signupState, setSignupState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [signupMessage, setSignupMessage] = useState('');
    const [showUnsignupConfirm, setShowUnsignupConfirm] = useState(false);
    const isSignedUp = persistedStatus === 'pending' || persistedStatus === 'registered';
    const userConfig = race.eventMode === 'multi' ? getUserEventConfig(race, userCategory) : null;
    const userSingleConfig = (race.eventMode !== 'multi' && race.eventMode !== 'grouped') ? getUserSingleConfig(race, userCategory) : null;
    const userGroupConfig = race.eventMode === 'grouped' ? getUserGroupConfig(race, userCategory) : null;
    const userGroupCatConfig = userGroupConfig?.categories.find(
        c => normalize(c.category) === normalize(userCategory)
    ) || null;

    const lapsToShow = race.eventMode === 'multi'
        ? (userConfig?.laps || race.laps || 1)
        : race.eventMode === 'grouped'
        ? (userGroupCatConfig?.laps || userGroupConfig?.laps || race.laps || 1)
        : (userSingleConfig?.laps || race.laps || 1);

    // Public cards always show the union of lap counts (e.g. "3/2").
    // Full cards: category riders see their own laps; others see the union.
    const omgangeDisplay = formatOmgangeDisplay(race, {
        userCategory,
        categoryLaps: lapsToShow,
        forceUnion: isPublicVariant,
    });

    const sprintsToShow = isPublicVariant
        ? getPublicSprints(race)
        : race.eventMode === 'multi'
        ? ((userConfig?.sprints && userConfig.sprints.length > 0) ? userConfig.sprints : (race.sprints || []))
        : race.eventMode === 'grouped'
        ? (
            (userGroupCatConfig?.sprints && userGroupCatConfig.sprints.length > 0)
                ? userGroupCatConfig.sprints
                : (userGroupConfig?.sprints && userGroupConfig.sprints.length > 0)
                ? userGroupConfig.sprints
                : (race.sprints || [])
          )
        : ((userSingleConfig?.sprints && userSingleConfig.sprints.length > 0) ? userSingleConfig.sprints : (race.sprints || []));

    const resolvedSprintsToShow = sprintsToShow.length > 0
        ? sprintsToShow
        : fallbackSprintsFromSelectedKeys(race.selectedSegments);

    const hasSprintsAndRoute = resolvedSprintsToShow.length > 0;

    const { data: elevationData } = useRouteElevationQuery(
        race.map && race.routeName ? race.map : undefined,
        race.map && race.routeName ? race.routeName : undefined,
        lapsToShow,
    );

    const leadInKm = Number(elevationData?.leadInDistance) || 0;
    const displayDistanceKm = scaleRaceDistanceKm(
        race.totalDistance ?? 0,
        Math.max(1, race.laps ?? 1),
        Math.max(1, lapsToShow),
        leadInKm,
    );

    const { data: eventSegmentsData } = useRaceSegmentsQuery(
        race.routeId,
        lapsToShow,
        hasSprintsAndRoute,
    );
    const eventSegments = eventSegmentsData ?? [];

    const resolvedProfileSprintsToShow = resolvedSprintsToShow.map((seg) => {
        const segId = String(seg.id || '').trim();
        if (!segId || eventSegments.length === 0) return seg;

        const desiredCount = Number.isFinite(seg.count) && seg.count > 0 ? seg.count : 1;
        const desiredDir = normalizeDirectionForMatch(seg.direction, seg.name);
        const exact = eventSegments.find((e) => {
            const sameId = String(e.id || '').trim() === segId;
            const sameCount = (Number(e.count) || 0) === desiredCount;
            const eDir = normalizeDirectionForMatch(e.direction, seg.name);
            return sameId && sameCount && eDir === desiredDir;
        });
        if (!exact) return seg;

        // Count occurrences on actual race laps only (lap >= 1), excluding lead-in (lap 0).
        if ((exact.lap || 0) < 1) return seg;
        const onRouteOccurrence = eventSegments.filter((e) => {
            const sameId = String(e.id || '').trim() === segId;
            const eDir = normalizeDirectionForMatch(e.direction, seg.name);
            return sameId && eDir === desiredDir && (Number(e.lap) || 0) >= 1 && (Number(e.count) || 0) <= desiredCount;
        }).length;

        if (onRouteOccurrence < 1) return seg;
        return { ...seg, count: onRouteOccurrence };
    });

    const elevationDistances = elevationData?.distance;
    const tiledRaceKm =
        Array.isArray(elevationDistances) && elevationDistances.length > 0
            ? (elevationDistances[elevationDistances.length - 1] ?? 0) / 1000
            : 0;
    const fallbackLapKm =
        lapsToShow > 0 ? Math.max(0, displayDistanceKm - leadInKm) / lapsToShow : 0;
    const lapLengthKm =
        lapsToShow > 0 && tiledRaceKm > 0 ? tiledRaceKm / lapsToShow : fallbackLapKm;

    const mergedProfileSegments = mergeLapBannerProfileSegments(
        Array.isArray(elevationData?.profileSegments) ? elevationData.profileSegments : [],
        resolvedSprintsToShow,
        eventSegments,
        lapLengthKm,
    );

    const profileData: ProfileData | null = elevationData
        ? {
              leadInDistance: Number(elevationData.leadInDistance) || 0,
              profileSegments: mergedProfileSegments,
          }
        : null;

    // Single-lap chart: only end-of-lap-1 banner markers (chart fetches laps=1 itself).
    const singleLapBannerSegments = mergeLapBannerProfileSegments(
        [],
        resolvedSprintsToShow.filter((s) => (s.lap || 1) === 1),
        eventSegments.filter((e) => (Number(e.lap) || 0) === 1),
        lapLengthKm,
    );

    const racePassHref = race.eventMode === 'multi'
        ? (userConfig?.eventId ? getZwiftEventUrl(userConfig.eventId, userConfig.eventSecret) : null)
        : race.eventMode === 'grouped'
        ? (userGroupConfig?.eventId ? getZwiftEventUrl(userGroupConfig.eventId, userGroupConfig.eventSecret) : null)
        : (race.eventId ? getZwiftEventUrl(race.eventId, race.eventSecret) : null);

    // Show a category hint when multiple categories share the same Zwift event so the user
    // knows which category to select after clicking the race pass link.
    const categoryHint = (() => {
        if (race.eventMode === 'single' && (race.singleModeCategories?.length ?? 0) > 1) {
            return userSingleConfig?.category || userCategory || null;
        }
        if (race.eventMode === 'grouped' && (userGroupConfig?.categories?.length ?? 0) > 1) {
            return userGroupCatConfig?.category || userCategory || null;
        }
        return null;
    })();

    const handleZwiftSignup = async () => {
        if (!user || signupState === 'loading') return;
        setSignupState('loading');
        setSignupMessage('');
        try {
            const token = await user.getIdToken();
            const res = await fetch(`${API_URL}/races/${race.id}/signup`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            await queryClient.invalidateQueries({ queryKey: ['race-signups'] });
            if (res.ok) {
                setSignupState(data.status === 'failed' ? 'error' : 'success');
                setSignupMessage(data.message || 'Tilmeldt!');
            } else {
                setSignupState('error');
                setSignupMessage(data.message || 'Tilmelding fejlede');
            }
        } catch {
            setSignupState('error');
            setSignupMessage('Netværksfejl – prøv igen');
        }
    };

    const handleZwiftUnsignup = async () => {
        if (!user || signupState === 'loading') return;
        setSignupState('loading');
        setSignupMessage('');
        try {
            const token = await user.getIdToken();
            const res = await fetch(`${API_URL}/races/${race.id}/signup`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            await queryClient.invalidateQueries({ queryKey: ['race-signups'] });
            if (res.ok) {
                setSignupState('idle');
                setSignupMessage(data.message || 'Afmeldt');
            } else {
                setSignupState('error');
                setSignupMessage(data.message || 'Afmelding fejlede');
            }
        } catch {
            setSignupState('error');
            setSignupMessage('Netværksfejl – prøv igen');
        } finally {
            // Close the dialog either way — success flips the card back to "Tilmeld",
            // failure surfaces the message under the card.
            setShowUnsignupConfirm(false);
        }
    };

    return (
        <div
            className={`bg-card border border-border rounded-lg shadow-sm overflow-hidden mb-6 ${isPast ? 'opacity-75' : ''} ${
                !isPublicVariant && isRegistered && !isPast && isSignedUp ? 'border-l-4 border-l-green-500' : ''
            }`}
        >
            <div className={isPublicVariant ? 'p-4 md:p-5' : 'p-6'}>
                <div className={`flex flex-col md:flex-row justify-between md:items-start gap-4 ${isPublicVariant ? 'mb-3' : 'mb-4'}`}>
                    <div>
                        <div className="text-sm font-medium text-primary mb-1">
                            {formatDateLong(raceDate)}
                        </div>
                        {(eventName || seasonClassLabel || stageLabel) && (
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                                {seasonClassLabel && (
                                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground bg-muted/40 border border-border px-2 py-0.5 rounded">
                                        {seasonClassLabel}
                                    </span>
                                )}
                                {eventName && (
                                    <span className="text-sm font-medium text-muted-foreground">{eventName}</span>
                                )}
                                {stageLabel && (
                                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground bg-muted/40 border border-border px-2 py-0.5 rounded">
                                        {stageLabel}
                                    </span>
                                )}
                            </div>
                        )}
                        <h3 className={isPublicVariant ? 'text-xl font-bold text-card-foreground' : 'text-2xl font-bold text-card-foreground'}>{race.name}</h3>
                        <div className="text-muted-foreground text-sm mt-1">
                            Start: {formatTimeWithTz(raceDate)}
                        </div>
                    </div>
                    <div className="bg-muted/30 px-4 py-2 rounded-lg text-right">
                        <div className="font-semibold text-card-foreground">{race.map || 'TBD'}</div>
                        <div className="text-sm text-muted-foreground flex items-center justify-end gap-1">
                            {race.routeName || 'TBD'}
                            {race.routeName && (
                                <a
                                    href={getZwiftInsiderUrl(race.routeName)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-primary hover:underline"
                                    title="View on ZwiftInsider"
                                >
                                    (ZI ↗)
                                </a>
                            )}
                        </div>
                    </div>
                </div>

                <div className={`grid grid-cols-2 sm:grid-cols-4 gap-4 ${isPublicVariant ? 'mb-4' : 'mb-6'} text-sm`}>
                    <div className="bg-muted/20 p-3 rounded text-center">
                        <div className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Distance</div>
                        <div className="font-semibold text-card-foreground">
                            {race.routeName ? `${displayDistanceKm} km` : 'TBD'}
                        </div>
                    </div>
                    <div className="bg-muted/20 p-3 rounded text-center">
                        <div className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Højdemeter</div>
                        <div className="font-semibold text-card-foreground">
                            {race.routeName ? `${race.totalElevation ?? 0} m` : 'TBD'}
                        </div>
                    </div>
                    <div className="bg-muted/20 p-3 rounded text-center flex flex-col justify-center">
                        <div className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Omgange</div>
                        <div className="font-semibold text-card-foreground flex justify-center items-center h-full">
                            {race.routeName ? omgangeDisplay : 'TBD'}
                        </div>
                    </div>
                    <Link
                        href={`/participants?race=${encodeURIComponent(race.id)}`}
                        className="group block bg-muted/20 hover:bg-muted/40 p-3 rounded text-center transition-colors"
                        title={`Se tilmeldte til ${race.name}`}
                    >
                        <div className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Tilmeldte</div>
                        <div className="font-semibold text-card-foreground tabular-nums inline-flex items-center gap-1 group-hover:text-primary transition-colors">
                            {signupCountsQuery.isLoading ? '–' : signupCount}
                            <span aria-hidden className="text-primary opacity-50 group-hover:opacity-100 transition-opacity">→</span>
                        </div>
                    </Link>
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
                            laps={1}
                            pointSegments={resolvedProfileSprintsToShow}
                            extraProfileSegments={singleLapBannerSegments}
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
                        <SprintsByLap sprints={resolvedProfileSprintsToShow} profileData={profileData} />
                    </div>
                )}

                {!isPublicVariant && (race.preRegisterAllowed || racePassHref) ? (
                    <div className="flex flex-col gap-2">
                        {categoryHint && !(isRegistered && !isPast && isSignedUp) && (
                            <div className="flex items-center justify-center gap-2 text-sm bg-muted/40 border border-border rounded-lg px-4 py-2">
                                <span className="text-muted-foreground">Kategori:</span>
                                <span className="font-semibold text-card-foreground">{categoryHint}</span>
                            </div>
                        )}
                        {isRegistered && !isPast ? (
                            <div className="flex flex-col gap-1">
                                {isSignedUp ? (
                                    <>
                                        <div className="flex items-center justify-between gap-3 rounded-lg border border-green-500/40 bg-green-50 dark:bg-green-950/30 px-4 py-3">
                                            <span
                                                className="inline-flex items-center gap-2 text-green-800 dark:text-green-300 font-bold"
                                                role="status"
                                            >
                                                <CheckIcon size={18} />
                                                <span>
                                                    Tilmeldt
                                                    {categoryHint && (
                                                        <span className="font-medium text-green-700/80 dark:text-green-400/80">
                                                            {' · '}{categoryHint}
                                                        </span>
                                                    )}
                                                </span>
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => setShowUnsignupConfirm(true)}
                                                disabled={signupState === 'loading'}
                                                className="shrink-0 text-xs font-semibold underline underline-offset-2 transition disabled:opacity-60 text-green-800/70 dark:text-green-300/70 hover:text-red-700 dark:hover:text-red-400"
                                            >
                                                {signupState === 'loading' ? 'Afmelder...' : 'Afmeld'}
                                            </button>
                                        </div>
                                        <p className="text-xs text-center text-muted-foreground">
                                            {persistedStatus === 'pending' && !racePassHref
                                                ? 'Du tilmeldes automatisk på Zwift når løbspas er klar. '
                                                : persistedStatus === 'registered'
                                                ? 'Du er tilmeldt på Zwift. '
                                                : ''}
                                            Se tilmeldte under{' '}
                                            <Link
                                                href={`/participants?race=${encodeURIComponent(race.id)}`}
                                                className="text-primary underline hover:no-underline"
                                            >
                                                Deltagere
                                            </Link>
                                            .
                                        </p>
                                    </>
                                ) : (
                                    <button
                                        onClick={handleZwiftSignup}
                                        disabled={signupState === 'loading'}
                                        className="block w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-lg text-center transition shadow-md disabled:opacity-60 disabled:cursor-not-allowed"
                                    >
                                        {signupState === 'loading' ? 'Tilmelder...' : persistedStatus === 'failed' ? 'Prøv igen' : 'Tilmeld'}
                                    </button>
                                )}
                                {(signupMessage || persistedStatus === 'failed') && (
                                    <p className={`text-sm text-center ${signupState === 'error' || persistedStatus === 'failed' ? 'text-red-500' : 'text-green-600'}`}>
                                        {signupMessage || (persistedStatus === 'failed' ? 'Tilmelding på Zwift fejlede — prøv igen.' : '')}
                                    </p>
                                )}
                            </div>
                        ) : !isRegistered && !isPast ? (
                            <div className="text-sm text-center text-muted-foreground bg-muted/40 border border-border rounded-lg px-4 py-3">
                                Du skal tilknytte en Zwift-konto i din{' '}
                                <a href="/register" className="text-primary underline hover:no-underline">profil</a>
                                {' '}for at tilmelde dig direkte.
                            </div>
                        ) : null}
                    </div>
                ) : !isPublicVariant ? (
                    <div
                        className="block w-full bg-muted text-muted-foreground font-bold py-3 px-4 rounded-lg text-center shadow-sm cursor-not-allowed"
                        title="Løbspas kommer snart - hold øje"
                    >
                        Løbspas kommer snart
                    </div>
                ) : null}
            </div>

            <ConfirmUnsignupModal
                isOpen={showUnsignupConfirm}
                raceName={race.name}
                raceDateLabel={`den ${formatDateShort(raceDate)}`}
                categoryHint={categoryHint}
                isLoading={signupState === 'loading'}
                onConfirm={handleZwiftUnsignup}
                onClose={() => setShowUnsignupConfirm(false)}
            />
        </div>
    );
}

