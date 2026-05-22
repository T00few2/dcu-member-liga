'use client';

import type { Race } from '@/types/live';
import { fromTimestamp } from '@/lib/formatDate';

interface Props {
    race: Race | null;
    category: string;
    loading?: boolean;
}

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

export default function LiveRaceResultsTable({ race, category, loading }: Props) {
    const rows = race?.results?.[category] ?? [];

    return (
        <section className="border-t border-border pt-6 mt-6">
            <header className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h3 className="text-sm font-semibold text-card-foreground">Live resultater · {category}</h3>
                {race?.provisionalUpdatedAt && (
                    <span className="text-xs text-muted-foreground">
                        Sidst opdateret: {formatUpdatedAt(race.provisionalUpdatedAt)}
                    </span>
                )}
            </header>

            {loading && (
                <p className="text-sm text-muted-foreground">Henter resultater…</p>
            )}

            {!loading && rows.length === 0 && (
                <p className="text-sm text-muted-foreground">
                    Ingen resultater endnu — venter på første passage.
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
        </section>
    );
}
