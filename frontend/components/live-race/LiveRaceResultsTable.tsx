'use client';

import { useMemo, useState } from 'react';
import type { LiveRider, Race, Sprint } from '@/types/live';
import { fromTimestamp } from '@/lib/formatDate';
import { useRaceSegmentsQuery, useRouteElevationQuery } from '@/hooks/queries';
import SprintsByLap, {
    normalizeSprintDirectionForMatch,
    type SprintsByLapProfileData,
} from '@/components/races/SprintsByLap';
import { formatTime, formatGap } from '@/app/results/_components/formatTime';

interface Props {
    race: Race | null;
    category: string;
    loading?: boolean;
    sprints: Sprint[];
    laps: number;
    routeId?: string | number;
    worldName?: string;
    routeName?: string;
    /** Hide live empty-state and replace with pre-race wording. */
    prerace?: boolean;
    /** Live-tracking riders from /live-riders endpoint, used to source club info. */
    liveRiders?: LiveRider[];
    /** True while the race is provisional/live; skips DNF/finalized treatment. */
    isLive?: boolean;
}

type TabKey = 'live' | 'info';

const pickFirstNonEmpty = (...lists: (Sprint[] | undefined)[]): Sprint[] => {
    for (const list of lists) {
        if (Array.isArray(list) && list.length > 0) return list;
    }
    return [];
};

function getConfiguredSprintsForCategory(race: Race | null | undefined, category: string): Sprint[] {
    if (!race) return [];
    if (race.eventMode === 'grouped' && race.raceGroups?.length) {
        const group = race.raceGroups.find(g => (g.categories || []).some(c => c.category === category));
        const catCfg = group?.categories?.find(c => c.category === category);
        return pickFirstNonEmpty(catCfg?.sprints, group?.sprints, race.sprints, race.sprintData);
    }
    if (race.eventMode === 'multi' && race.eventConfiguration) {
        const catConfig = race.eventConfiguration.find(c => c.customCategory === category);
        return pickFirstNonEmpty(catConfig?.sprints, race.sprints, race.sprintData);
    }
    if (race.singleModeCategories?.length) {
        const catConfig = race.singleModeCategories.find(c => c.category === category);
        return pickFirstNonEmpty(catConfig?.sprints, race.sprints, race.sprintData);
    }
    return pickFirstNonEmpty(race.sprints, race.sprintData);
}

function formatUpdatedAt(value?: string): string {
    const d = value ? fromTimestamp(value as never) : null;
    if (!d || Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('da-DK', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function LiveResultsView({
    race,
    category,
    loading,
    prerace,
    liveRiders,
    isLive,
}: {
    race: Race | null;
    category: string;
    loading?: boolean;
    prerace?: boolean;
    liveRiders?: LiveRider[];
    isLive?: boolean;
}) {
    const rows = race?.results?.[category] ?? [];

    const { clubByZwiftId, clubByName } = useMemo(() => {
        const byZwiftId = new Map<string, string>();
        const byName = new Map<string, string>();
        (liveRiders ?? []).forEach((rider) => {
            const zwiftId = String(rider.zwiftId ?? '').trim();
            const name = String(rider.name ?? '').trim().toLocaleLowerCase('da-DK');
            const club = String(rider.club ?? '').trim();
            if (!club) return;
            if (zwiftId) byZwiftId.set(zwiftId, club);
            if (name && !byName.has(name)) byName.set(name, club);
        });
        return { clubByZwiftId: byZwiftId, clubByName: byName };
    }, [liveRiders]);

    const { sprintColumns, bestSplitTimes } = useMemo(() => {
        const allSprintKeys = new Set<string>();
        rows.forEach((r) => {
            if (r.sprintDetails) Object.keys(r.sprintDetails).forEach((k) => allSprintKeys.add(k));
        });

        const orderedSprints = getConfiguredSprintsForCategory(race, category);
        const columns: string[] = [];
        orderedSprints.forEach((s) => {
            const key = [s.key, `${s.id}_${s.count}`, s.id].filter(Boolean).find((k) => allSprintKeys.has(k!)) as
                | string
                | undefined;
            if (key) {
                columns.push(key);
                allSprintKeys.delete(key);
            }
        });

        const finalColumns = [...columns, ...Array.from(allSprintKeys).sort()];
        const splitTimes: Record<string, number> = {};
        finalColumns.forEach((key) => {
            const sample = rows.find((r) => r.sprintDetails?.[key])?.sprintDetails?.[key];
            if (typeof sample === 'number' && sample > 1_000_000) {
                const times = rows
                    .map((r) => r.sprintDetails?.[key])
                    .filter((v): v is number => typeof v === 'number' && v > 0);
                if (times.length > 0) splitTimes[key] = Math.min(...times);
            }
        });

        return { sprintColumns: finalColumns, bestSplitTimes: splitTimes };
    }, [rows, race, category]);

    const getSprintHeader = (key: string): string => {
        const sourceSprints = getConfiguredSprintsForCategory(race, category);
        if (sourceSprints.length === 0) return key.replace(/_/g, ' ');
        const sprint = sourceSprints.find((s) => s.key === key || `${s.id}_${s.count}` === key || s.id === key);
        if (sprint) return `${sprint.name} #${sprint.count}`;
        const parts = key.split('_');
        if (parts.length >= 2) {
            const match = sourceSprints.find((s) => s.id == parts[0] && s.count == parseInt(parts[1]));
            if (match) return `${match.name} #${match.count}`;
        }
        return key.replace(/_/g, ' ');
    };

    const showFinishPointsColumn = rows.some((r) => (r.finishPoints ?? 0) > 0);
    const showTotalPointsColumn = rows.some((r) => (r.totalPoints ?? 0) > 0);

    const renderFinishTime = (finishTime: number, raceStatus?: string): string => {
        if (!finishTime || finishTime <= 0) {
            return isLive ? '—' : formatTime(finishTime, raceStatus);
        }
        return formatTime(finishTime, raceStatus);
    };

    return (
        <>
            {race?.provisionalUpdatedAt && (
                <p className="text-xs text-muted-foreground mb-2">
                    Sidst opdateret: {formatUpdatedAt(race.provisionalUpdatedAt)}
                </p>
            )}

            {loading && <p className="text-sm text-muted-foreground">Henter resultater…</p>}

            {!loading && rows.length === 0 && (
                <p className="text-sm text-muted-foreground">
                    {prerace
                        ? 'Løbet er ikke startet endnu.'
                        : 'Ingen resultater endnu — venter på første passage.'}
                </p>
            )}

            {rows.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                        <thead className="bg-muted/30 border-b border-border">
                            <tr>
                                <th className="text-center py-2 px-3 font-medium text-muted-foreground text-xs w-12">#</th>
                                <th className="text-left py-2 px-3 font-medium text-muted-foreground text-xs">Rytter</th>
                                <th className="text-left py-2 px-3 font-medium text-muted-foreground text-xs">Klub</th>
                                <th className="text-right py-2 px-3 font-medium text-muted-foreground text-xs">Tid</th>
                                {sprintColumns.map((sprintKey) => (
                                    <th
                                        key={sprintKey}
                                        className="px-2 py-2 text-center text-xs uppercase tracking-wider text-muted-foreground/70 whitespace-normal sm:max-w-[120px] min-w-[80px]"
                                    >
                                        {getSprintHeader(sprintKey)}
                                    </th>
                                ))}
                                {showFinishPointsColumn && (
                                    <th className="px-3 py-2 text-right text-muted-foreground/70 text-xs font-medium">
                                        Målpoint
                                    </th>
                                )}
                                {showTotalPointsColumn && (
                                    <th className="px-3 py-2 text-right text-primary text-xs font-bold">
                                        Total point
                                    </th>
                                )}
                                <th className="text-left py-2 px-3 font-medium text-muted-foreground text-xs">
                                    Status
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
                            {rows.map((row, idx) => {
                                const rank = row.finishRank && row.finishRank > 0 ? row.finishRank : idx + 1;
                                const finished =
                                    (row.finishRank && row.finishRank > 0) ||
                                    String(row.raceStatus || '').toUpperCase() === 'FIN' ||
                                    row.finishTime > 0;
                                const hasNoFinish = !row.finishTime || row.finishTime <= 0;
                                // Only treat as DNF for sprint/points columns once the race is
                                // finalized; in live mode show the running totals.
                                const isDnf = !isLive && hasNoFinish;
                                const club =
                                    clubByZwiftId.get(String(row.zwiftId ?? '').trim()) ||
                                    clubByName.get(String(row.name ?? '').trim().toLocaleLowerCase('da-DK')) ||
                                    '-';
                                return (
                                    <tr key={row.zwiftId || idx} className="hover:bg-muted/20 transition">
                                        <td className="py-2 px-3 text-center font-mono text-muted-foreground">{rank}</td>
                                        <td className="py-2 px-3 font-medium text-card-foreground">
                                            {row.name || 'Ukendt'}
                                        </td>
                                        <td className="py-2 px-3 text-muted-foreground">{club}</td>
                                        <td className="py-2 px-3 text-right font-mono text-muted-foreground">
                                            {renderFinishTime(row.finishTime, row.raceStatus)}
                                        </td>
                                        {sprintColumns.map((sprintKey) => {
                                            if (isDnf) {
                                                return (
                                                    <td
                                                        key={sprintKey}
                                                        className="px-2 py-2 text-center text-muted-foreground"
                                                    >
                                                        -
                                                    </td>
                                                );
                                            }
                                            const val = row.sprintDetails?.[sprintKey];
                                            const best = bestSplitTimes[sprintKey];

                                            let displayVal: React.ReactNode = '-';
                                            if (val !== undefined && val !== null) {
                                                if (best) {
                                                    const diff = (val as number) - best;
                                                    if (diff === 0)
                                                        displayVal = (
                                                            <span className="text-green-600 dark:text-green-400 font-bold">
                                                                0.00
                                                            </span>
                                                        );
                                                    else
                                                        displayVal = (
                                                            <span className="text-red-500 dark:text-red-400">
                                                                +{formatGap(diff)}
                                                            </span>
                                                        );
                                                } else {
                                                    displayVal = val as React.ReactNode;
                                                }
                                            }
                                            return (
                                                <td
                                                    key={sprintKey}
                                                    className="px-2 py-2 text-center text-muted-foreground"
                                                >
                                                    {displayVal}
                                                </td>
                                            );
                                        })}
                                        {showFinishPointsColumn && (
                                            <td className="px-3 py-2 text-right text-muted-foreground font-medium">
                                                {isDnf ? '-' : row.finishPoints ?? '-'}
                                            </td>
                                        )}
                                        {showTotalPointsColumn && (
                                            <td className="px-3 py-2 text-right font-bold text-foreground">
                                                {isDnf ? '-' : row.totalPoints ?? '-'}
                                            </td>
                                        )}
                                        <td className="py-2 px-3 text-muted-foreground">
                                            {finished ? 'I mål' : isLive ? 'I løb' : 'DNF'}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </>
    );
}

function InfoView({
    sprints,
    laps,
    routeId,
    worldName,
    routeName,
}: {
    sprints: Sprint[];
    laps: number;
    routeId?: string | number;
    worldName?: string;
    routeName?: string;
}) {
    const hasSprints = sprints.length > 0;

    const { data: elevationData } = useRouteElevationQuery(
        hasSprints ? worldName : undefined,
        hasSprintsAndRouteName(hasSprints, routeName) ? routeName : undefined,
        laps,
    );
    const { data: eventSegments = [] } = useRaceSegmentsQuery(routeId, laps, hasSprints && !!routeId);

    const profileData: SprintsByLapProfileData | null = elevationData
        ? {
              leadInDistance: Number(elevationData.leadInDistance) || 0,
              profileSegments: Array.isArray(elevationData.profileSegments) ? elevationData.profileSegments : [],
          }
        : null;

    const resolvedSprints = useMemo(() => {
        if (!sprints.length || !eventSegments.length) return sprints;
        return sprints.map((seg) => {
            const segId = String(seg.id || '').trim();
            if (!segId) return seg;
            const desiredCount = Number.isFinite(seg.count) && seg.count > 0 ? seg.count : 1;
            const desiredDir = normalizeSprintDirectionForMatch(seg.direction, seg.name);
            const exact = eventSegments.find((e) => {
                const sameId = String(e.id || '').trim() === segId;
                const sameCount = (Number(e.count) || 0) === desiredCount;
                const eDir = normalizeSprintDirectionForMatch(e.direction, seg.name);
                return sameId && sameCount && eDir === desiredDir;
            });
            if (!exact || (exact.lap || 0) < 1) return seg;
            const onRouteOccurrence = eventSegments.filter((e) => {
                const sameId = String(e.id || '').trim() === segId;
                const eDir = normalizeSprintDirectionForMatch(e.direction, seg.name);
                return sameId && eDir === desiredDir && (Number(e.lap) || 0) >= 1 && (Number(e.count) || 0) <= desiredCount;
            }).length;
            if (onRouteOccurrence < 1) return seg;
            return { ...seg, count: onRouteOccurrence };
        });
    }, [sprints, eventSegments]);

    if (!hasSprints) {
        return (
            <p className="text-sm text-muted-foreground">
                Ingen pointsprint for denne kategori.
            </p>
        );
    }

    return (
        <div className="space-y-2">
            <h4 className="text-sm font-semibold text-card-foreground">Pointsprint</h4>
            <SprintsByLap sprints={resolvedSprints} profileData={profileData} />
        </div>
    );
}

function hasSprintsAndRouteName(hasSprints: boolean, routeName?: string): routeName is string {
    return hasSprints && !!routeName;
}

export default function LiveRaceResultsTable({
    race,
    category,
    loading,
    sprints,
    laps,
    routeId,
    worldName,
    routeName,
    prerace,
    liveRiders,
    isLive,
}: Props) {
    const [tab, setTab] = useState<TabKey>('live');

    const tabBtn = (key: TabKey, label: string) => (
        <button
            type="button"
            onClick={() => setTab(key)}
            className={`px-3 py-1.5 text-sm font-semibold border-b-2 -mb-px transition ${
                tab === key
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-card-foreground'
            }`}
        >
            {label}
        </button>
    );

    return (
        <section className="border-t border-border pt-6 mt-6">
            <header className="flex flex-wrap items-end justify-between gap-2 mb-3 border-b border-border">
                <div className="flex items-center gap-1">
                    {tabBtn('live', prerace ? 'Live resultater' : `Live resultater · ${category}`)}
                    {tabBtn('info', 'Info')}
                </div>
            </header>

            {tab === 'live' ? (
                <LiveResultsView
                    race={race}
                    category={category}
                    loading={loading}
                    prerace={prerace}
                    liveRiders={liveRiders}
                    isLive={isLive}
                />
            ) : (
                <InfoView
                    sprints={sprints}
                    laps={laps}
                    routeId={routeId}
                    worldName={worldName}
                    routeName={routeName}
                />
            )}
        </section>
    );
}
