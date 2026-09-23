import type { ClubStandingRow } from '@/lib/clubStandings';

interface Props {
    rows: ClubStandingRow[];
}

export default function ClubStandingsTable({ rows }: Props) {
    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold text-card-foreground">Klub</h2>
            </div>
            <p className="text-sm text-muted-foreground">
                Klubbens point er summen af de tre ryttere med flest sæsonpoint. Alle divisioner tæller med.
            </p>
            <div className="bg-card border border-border rounded-lg overflow-hidden shadow-sm">
                {rows.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-[#E7E3D6] text-slate-800 border-b-2 border-slate-300">
                                <tr>
                                    <th className="px-4 py-3 w-12 text-center">Rang</th>
                                    <th className="px-4 py-3">Klub</th>
                                    <th className="px-4 py-3">Tællende ryttere</th>
                                    <th className="px-4 py-3 text-right font-bold text-primary">Point</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {rows.map((row, idx) => (
                                    <tr key={row.club} className="hover:bg-muted/20 transition odd:bg-transparent even:bg-[#f1efe7]">
                                        <td className="px-4 py-3 text-center font-medium text-muted-foreground">
                                            {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                                        </td>
                                        <td className="px-4 py-3 font-medium text-card-foreground">{row.club}</td>
                                        <td className="px-4 py-3 text-muted-foreground whitespace-normal">
                                            {row.riders.map((rider) => `${rider.name} (${rider.points})`).join(', ')}
                                        </td>
                                        <td className="px-4 py-3 text-right font-bold text-foreground text-lg">{row.points}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="p-12 text-center text-muted-foreground">
                        Ingen klubstilling tilgængelig endnu.
                    </div>
                )}
            </div>
        </div>
    );
}
