import type { Race, StandingEntry } from '@/types/live';

type ProcessedRider = StandingEntry & { calculatedTotal: number; countingRaceIds: Set<string> };

interface Props {
    currentStandings: ProcessedRider[];
    races: Race[];
    availableStandingsCategories: string[];
    displayStandingsCategory: string;
    standingsCategory: string;
    setStandingsCategory: (cat: string) => void;
}

export default function StandingsTable({
    currentStandings,
    races,
    availableStandingsCategories,
    displayStandingsCategory,
    standingsCategory,
    setStandingsCategory,
}: Props) {
    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold text-card-foreground">Førertavle</h2>
                <div className="flex gap-2 bg-muted/20 rounded p-1 overflow-x-auto">
                    {availableStandingsCategories.map(cat => (
                        <button
                            key={cat}
                            onClick={() => setStandingsCategory(cat)}
                            className={`px-3 py-1 text-sm rounded transition-colors whitespace-nowrap ${displayStandingsCategory === cat
                                ? 'bg-primary text-primary-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                                }`}
                        >
                            {cat}
                        </button>
                    ))}
                </div>
            </div>

            <div className="bg-card border border-border rounded-lg overflow-hidden shadow-sm">
                {currentStandings.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-[#E7E3D6] text-slate-800 border-b-2 border-slate-300">
                                <tr>
                                    <th className="px-4 py-3 w-12 text-center">Rang</th>
                                    <th className="px-4 py-3">Rytter</th>
                                    <th className="px-4 py-3 text-center">Løb</th>
                                    {races.map((race) => (
                                        <th key={race.id} className="px-2 py-3 text-center text-xs font-medium text-muted-foreground whitespace-normal min-w-[60px]">
                                            {race.name}
                                        </th>
                                    ))}
                                    <th className="px-4 py-3 text-right font-bold text-primary">Samlede point</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {currentStandings.map((rider, idx) => (
                                    <tr key={rider.zwiftId} className="hover:bg-muted/20 transition odd:bg-transparent even:bg-[#f1efe7]">
                                        <td className="px-4 py-3 text-center font-medium text-muted-foreground">
                                            {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                                        </td>
                                        <td className="px-4 py-3 font-medium text-card-foreground">{rider.name}</td>
                                        <td className="px-4 py-3 text-center text-muted-foreground">{rider.raceCount}</td>
                                        {races.map(race => {
                                            const result = rider.results.find(r => r.raceId === race.id);
                                            const isCounting = rider.countingRaceIds.has(race.id);
                                            return (
                                                <td
                                                    key={race.id}
                                                    className={`px-2 py-3 text-center text-sm ${result
                                                        ? isCounting
                                                            ? 'text-foreground font-medium'
                                                            : 'text-muted-foreground/50 line-through'
                                                        : 'text-muted-foreground'
                                                        }`}
                                                    title={result && !isCounting ? 'Tæller ikke (uden for top 5)' : undefined}
                                                >
                                                    {result ? result.points : '-'}
                                                </td>
                                            );
                                        })}
                                        <td className="px-4 py-3 text-right font-bold text-foreground text-lg">{rider.calculatedTotal}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="p-12 text-center text-muted-foreground">
                        Ingen stilling tilgængelig endnu.
                    </div>
                )}
            </div>
        </div>
    );
}
