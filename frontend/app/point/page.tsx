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

type Tab = 'race-day' | 'season';

const PUBLIC_SEASON_KEYS: { key: SeasonPointTableKey; label: string }[] = [
    { key: 'tour_overall', label: 'Tour samlet (GC)' },
    { key: 'tour_stage', label: 'Tour-etape' },
    { key: 'wt_classic', label: 'Klassiker' },
];

export default function PointPage() {
    const settingsQuery = useLeagueSettingsQuery();
    const [tab, setTab] = useState<Tab>('race-day');
    const settings = settingsQuery.data;

    const raceDayColumns: PointsPlaceColumn[] = useMemo(() => {
        const finish = settings?.finishPoints ?? [];
        const sprint = settings?.sprintPoints ?? [];
        const league = settings?.leagueRankPoints ?? [];
        const rows = Math.max(finish.length, sprint.length, league.length);
        const pad = (arr: number[]) => {
            const out = [...arr];
            while (out.length < rows) out.push(0);
            return out;
        };
        return [
            { key: 'finish', label: 'Mål', values: pad(finish) },
            { key: 'sprint', label: 'Spurt', values: pad(sprint) },
            { key: 'league', label: 'Løbsplacering', values: pad(league) },
        ];
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
                På løbsdagen giver mål- og spurtpoint din placering i løbet. Placeringen giver point til
                sæsonen sammen med prestige for Tour og Klassikere.
            </p>

            <div className="flex gap-2 mb-6 border-b border-border">
                {(
                    [
                        { id: 'race-day' as const, label: 'Løbsdag' },
                        { id: 'season' as const, label: 'Sæson' },
                    ] as const
                ).map((t) => (
                    <button
                        key={t.id}
                        type="button"
                        onClick={() => setTab(t.id)}
                        className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                            tab === t.id
                                ? 'border-primary text-primary'
                                : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {tab === 'race-day' ? (
                <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                        Point for mål, spurt og den samlede løbsplacering (ranglistepoint for dagen).
                    </p>
                    <PointsPlaceTable columns={raceDayColumns} readOnly />
                </div>
            ) : (
                <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                        Sæsonprestige for Tour (samlet + etape) og Klassikere — tæller til Sæsonstillingen.
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
