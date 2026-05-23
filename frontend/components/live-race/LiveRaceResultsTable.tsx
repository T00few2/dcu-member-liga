'use client';

import { useMemo, useState } from 'react';
import type { Race, Sprint } from '@/types/live';
import { fromTimestamp } from '@/lib/formatDate';
import { useRaceSegmentsQuery, useRouteElevationQuery } from '@/hooks/queries';
import SprintsByLap, {
    normalizeSprintDirectionForMatch,
    type SprintsByLapProfileData,
} from '@/components/races/SprintsByLap';

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
}

type TabKey = 'live' | 'info';

function formatFinishTime(finishTime: number): string {
    if (!finishTime || finishTime <= 0) return '—';
    const d = new Date(finishTime);
    if (!Number.isNaN(d.getTime()) && d.getFullYear() > 1980) {
        return d.toISOString().substring(11, 19);
    }
    const totalSec = Math.floor(finishTime / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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
}: {
    race: Race | null;
    category: string;
    loading?: boolean;
    prerace?: boolean;
}) {
    const rows = race?.results?.[category] ?? [];

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
                    <table className="w-full text-sm">
                        <thead className="bg-muted/30 border-b border-border">
                            <tr>
                                <th className="text-left py-2 px-3 font-medium text-muted-foreground text-xs">#</th>
                                <th className="text-left py-2 px-3 font-medium text-muted-foreground text-xs">Rytter</th>
                                <th className="text-left py-2 px-3 font-medium text-muted-foreground text-xs">Klub</th>
                                <th className="text-right py-2 px-3 font-medium text-muted-foreground text-xs">Tid</th>
                                <th className="text-left py-2 px-3 font-medium text-muted-foreground text-xs">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row, idx) => {
                                const rank = row.finishRank && row.finishRank > 0 ? row.finishRank : idx + 1;
                                const finished =
                                    (row.finishRank && row.finishRank > 0) ||
                                    String(row.raceStatus || '').toUpperCase() === 'FIN' ||
                                    row.finishTime > 0;
                                return (
                                    <tr key={row.zwiftId || idx} className="border-b border-border/50 last:border-0">
                                        <td className="py-2 px-3 font-mono text-muted-foreground">{rank}</td>
                                        <td className="py-2 px-3 font-medium text-card-foreground">{row.name || 'Ukendt'}</td>
                                        <td className="py-2 px-3 text-muted-foreground">—</td>
                                        <td className="py-2 px-3 text-right font-mono">{formatFinishTime(row.finishTime)}</td>
                                        <td className="py-2 px-3">{finished ? 'I mål' : 'I løb'}</td>
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
                <LiveResultsView race={race} category={category} loading={loading} prerace={prerace} />
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
