'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLeagueSettingsQuery } from '@/hooks/queries';
import PointsPlaceTable, { type PointsPlaceColumn } from '@/components/admin/league-manager/PointsPlaceTable';
import {
    DEFAULT_SEASON_RANK_POINTS,
    expandSeasonTableToByPlace,
    maxPlaceInTable,
    type SeasonPointTableKey,
} from '@/lib/seasonPointsDefaults';

type Tab = 'race-day' | 'tour-gc' | 'season';

const TABS: { id: Tab; label: string }[] = [
    { id: 'race-day', label: 'Løbspoint' },
    { id: 'tour-gc', label: 'Tour-GC' },
    { id: 'season', label: 'Sæson' },
];

const PUBLIC_SEASON_KEYS: { key: SeasonPointTableKey; label: string }[] = [
    { key: 'tour_overall', label: 'Tour samlet (GC)' },
    { key: 'tour_stage', label: 'Tour-etape' },
    { key: 'wt_classic', label: 'Klassiker' },
];

function padToLength(arr: number[], rows: number): number[] {
    if (arr.length >= rows) return arr;
    const out = [...arr];
    while (out.length < rows) out.push(0);
    return out;
}

export default function PointPage() {
    const settingsQuery = useLeagueSettingsQuery();
    const [tab, setTab] = useState<Tab>('race-day');
    const settings = settingsQuery.data;

    const raceDayColumns: PointsPlaceColumn[] = useMemo(() => {
        const finish = settings?.finishPoints ?? [];
        const sprint = settings?.sprintPoints ?? [];
        const rows = Math.max(finish.length, sprint.length);
        return [
            { key: 'finish', label: 'Mål', values: padToLength(finish, rows) },
            { key: 'sprint', label: 'Spurt', values: padToLength(sprint, rows) },
        ];
    }, [settings]);

    const tourGcColumns: PointsPlaceColumn[] = useMemo(() => {
        const league = settings?.leagueRankPoints ?? [];
        return [{ key: 'league', label: 'Løbsplacering', values: league }];
    }, [settings]);

    const seasonColumns: PointsPlaceColumn[] = useMemo(() => {
        const src = settings?.seasonRankPoints || DEFAULT_SEASON_RANK_POINTS;
        let maxPlace = 0;
        for (const { key } of PUBLIC_SEASON_KEYS) {
            maxPlace = Math.max(maxPlace, maxPlaceInTable(src[key] || DEFAULT_SEASON_RANK_POINTS[key]));
        }
        return PUBLIC_SEASON_KEYS.map(({ key, label }) => ({
            key,
            label,
            values: expandSeasonTableToByPlace(src[key] || DEFAULT_SEASON_RANK_POINTS[key], maxPlace),
        }));
    }, [settings]);

    if (settingsQuery.isLoading) {
        return <div className="p-8 text-center text-muted-foreground">Indlæser pointskalaer...</div>;
    }

    if (settingsQuery.isError) {
        return (
            <div className="max-w-4xl mx-auto px-4 py-8 text-center text-muted-foreground">
                Kunne ikke hente pointskalaer. Prøv igen senere.
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto px-4 py-8">
            <h1 className="text-3xl font-bold mb-2 text-foreground">Point</h1>
            <p className="text-muted-foreground mb-6 max-w-2xl">
                Pointskalaerne er delt i tre: løbspoint (mål og FAL-spurter), Tour-GC (etapeplacering til
                samlet stilling) og sæsonpoint til Sæsonstillingen.
            </p>

            <div className="flex gap-2 mb-6 border-b border-border overflow-x-auto overflow-y-hidden">
                {TABS.map((t) => (
                    <button
                        key={t.id}
                        type="button"
                        onClick={() => setTab(t.id)}
                        className={`shrink-0 px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                            tab === t.id
                                ? 'border-primary text-primary'
                                : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {tab === 'race-day' && (
                <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                        Point for mål og FAL-spurter (først over stregen) i det enkelte løb. Den samlede
                        score afgør dagens placering.
                    </p>
                    <PointsPlaceTable columns={raceDayColumns} readOnly />
                </div>
            )}

            {tab === 'tour-gc' && (
                <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                        Klassikere scores som beskrevet under Løbspoint. I Touren omsættes hver etapes
                        placering til GC-point med tabellen herunder, som summeres på tværs af etaperne.
                    </p>
                    <PointsPlaceTable columns={tourGcColumns} readOnly />
                </div>
            )}

            {tab === 'season' && (
                <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                        Sæsonpoint for Tour (samlet + etape) og Klassikere — tæller til Sæsonstillingen,
                        ikke til Tourens interne GC.
                    </p>
                    <PointsPlaceTable columns={seasonColumns} readOnly />
                </div>
            )}

            <p className="mt-8 text-sm text-muted-foreground">
                Se også{' '}
                <Link href="/schedule" className="text-primary underline hover:no-underline">
                    sæsonkalenderen
                </Link>{' '}
                og{' '}
                <Link href="/results" className="text-primary underline hover:no-underline">
                    resultater
                </Link>
                .
            </p>
        </div>
    );
}
