import { Race, StandingEntry, OverlayConfig } from '@/types/live';
import { shortenRiderName } from '@/lib/formatters';
import { resolveColor } from '@/lib/colors';

interface RaceResult {
    zwiftId: string;
    name: string;
    finishTime?: number;
    totalPoints?: number;
}

interface StandingsTableProps {
    standings: StandingEntry[];
    allRaces: Race[];
    category: string;
    bestRacesCount: number;
    config: {
        isFull: boolean;
        limit: number;
        nameMax: number;
    };
    overlay: OverlayConfig;
    currentRaceResults?: RaceResult[]; // Optional: show participants when no standings
}

export function StandingsTable({ standings, allRaces, category, bestRacesCount, config, overlay, currentRaceResults }: StandingsTableProps) {
    const { isFull, limit, nameMax } = config;

    // Get race IDs that have results for this category
    const raceIdsWithResults = new Set<string>();
    standings.forEach(rider => {
        rider.results.forEach(r => raceIdsWithResults.add(r.raceId));
    });
    
    // Filter and sort races that have results
    const relevantRaces = allRaces.filter(r => raceIdsWithResults.has(r.id));
    
    // Process Best X
    const processedStandings = standings.map(rider => {
        const sortedResults = [...rider.results].sort((a, b) => b.points - a.points);
        const bestResults = sortedResults.slice(0, bestRacesCount);
        const bestTotal = bestResults.reduce((sum, r) => sum + r.points, 0);
        const bestRaceIds = new Set(bestResults.map(r => r.raceId));
        
        // Create a map of raceId -> points for quick lookup
        const pointsByRace: Record<string, { points: number, isBest: boolean }> = {};
        rider.results.forEach(r => {
            pointsByRace[r.raceId] = { 
                points: r.points, 
                isBest: bestRaceIds.has(r.raceId) 
            };
        });
        
        return {
            ...rider,
            calculatedTotal: bestTotal,
            pointsByRace
        };
    });

    // Sort
    const currentStandings = processedStandings.sort((a, b) => (b.calculatedTotal || 0) - (a.calculatedTotal || 0));
    const displayResults = currentStandings.slice(0, limit);

    // Format race name for header (short version)
    const getRaceShortName = (race: Race, index: number) => {
        if (isFull) return race.name;
        return `R${index + 1}`;
    };

    const totalColumns = 2 + relevantRaces.length + 1; // #, name, races..., total

    // Styling
    const headerCellPadding = isFull ? 'py-0' : 'py-1';
    const bodyCellPadding = isFull ? 'py-0.5' : 'py-2';
    const tableBodyTextSize = isFull ? 'text-2xl' : 'text-3xl';

    return (
        <table className="w-full text-left border-collapse">
            <thead>
                <tr
                    className="text-slate-400 text-sm uppercase tracking-wider border-b-2 border-slate-600 bg-slate-800/80"
                    style={{
                        backgroundColor: resolveColor(overlay.headerBg),
                        color: resolveColor(overlay.headerText, overlay.text),
                        borderColor: resolveColor(overlay.border)
                    }}
                >
                    <th
                        className={`sticky top-0 z-10 bg-slate-800/90 ${headerCellPadding} px-1 w-10 text-center`}
                        style={{ backgroundColor: resolveColor(overlay.headerBg) }}
                    >
                        #
                    </th>
                    <th
                        className={`sticky top-0 z-10 bg-slate-800/90 ${headerCellPadding} px-2`}
                        style={{ backgroundColor: resolveColor(overlay.headerBg) }}
                    >
                        Rider
                    </th>
                    {relevantRaces.map((race, idx) => (
                        <th 
                            key={race.id}
                            className={`sticky top-0 z-10 bg-slate-800/90 ${headerCellPadding} px-1 text-center font-bold text-blue-400 ${isFull ? 'min-w-[120px] max-w-[200px]' : 'w-12'}`}
                            title={`${race.name} (${new Date(race.date).toLocaleDateString()})`}
                            style={{
                                backgroundColor: resolveColor(overlay.headerBg),
                                color: resolveColor(overlay.accent, overlay.headerText || overlay.text || undefined)
                            }}
                        >
                            {getRaceShortName(race, idx)}
                        </th>
                    ))}
                    <th
                        className={`sticky top-0 z-10 bg-slate-800/90 ${headerCellPadding} px-2 text-center font-bold text-green-400 w-16`}
                        style={{
                            backgroundColor: resolveColor(overlay.headerBg),
                            color: resolveColor(overlay.positive, overlay.headerText || overlay.text || undefined)
                        }}
                    >
                        Total
                    </th>
                </tr>
            </thead>
            <tbody
                className={`text-white font-bold ${tableBodyTextSize}`}
                style={{ color: resolveColor(overlay.rowText, overlay.text) }}
            >
                {displayResults.map((rider, idx) => (
                    <tr 
                        key={rider.zwiftId} 
                        className="border-b border-slate-700/50 even:bg-slate-800/40"
                        style={{
                            borderColor: resolveColor(overlay.border),
                            backgroundColor: idx % 2 === 1
                                ? resolveColor(overlay.rowAltBg, overlay.rowBg)
                                : resolveColor(overlay.rowBg)
                        }}
                    >
                        <td
                            className={`${bodyCellPadding} px-1 text-center font-bold text-slate-300 align-middle`}
                            style={{ color: resolveColor(overlay.muted, overlay.rowText || overlay.text || undefined) }}
                        >
                            {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                        </td>
                        <td className={`${bodyCellPadding} px-2 truncate align-middle`}>
                            {shortenRiderName(rider.name, nameMax)}
                        </td>
                        {relevantRaces.map(race => {
                            const raceResult = rider.pointsByRace?.[race.id];
                            const points = raceResult?.points;
                            const isBest = raceResult?.isBest;
                            return (
                                <td 
                                    key={race.id} 
                                    className={`${bodyCellPadding} px-1 text-center align-middle ${
                                        isBest ? 'text-green-400 font-extrabold' : 'text-slate-400'
                                    }`}
                                    style={{
                                        color: resolveColor(
                                            isBest ? overlay.positive : overlay.muted,
                                            overlay.rowText || overlay.text || undefined
                                        )
                                    }}
                                >
                                    {points !== undefined ? points : '-'}
                                </td>
                            );
                        })}
                        <td
                            className={`${bodyCellPadding} px-2 text-center font-extrabold text-green-400 align-middle`}
                            style={{ color: resolveColor(overlay.positive, overlay.rowText || overlay.text || undefined) }}
                        >
                            {rider.calculatedTotal}
                        </td>
                    </tr>
                ))}
                {displayResults.length === 0 && currentRaceResults && currentRaceResults.length > 0 && (
                    // Show participants from current race when no standings yet
                    currentRaceResults.slice(0, limit).map((rider, idx) => (
                        <tr 
                            key={rider.zwiftId} 
                            className="border-b border-slate-700/50 even:bg-slate-800/40"
                            style={{
                                borderColor: resolveColor(overlay.border),
                                backgroundColor: idx % 2 === 1
                                    ? resolveColor(overlay.rowAltBg, overlay.rowBg)
                                    : resolveColor(overlay.rowBg)
                            }}
                        >
                            <td
                                className={`${bodyCellPadding} px-1 text-center font-bold text-slate-300 align-middle`}
                                style={{ color: resolveColor(overlay.muted, overlay.rowText || overlay.text || undefined) }}
                            >
                                {idx + 1}
                            </td>
                            <td className={`${bodyCellPadding} px-2 truncate align-middle`}>
                                {shortenRiderName(rider.name, nameMax)}
                            </td>
                            <td
                                className={`${bodyCellPadding} px-2 text-center font-extrabold text-slate-500 align-middle`}
                                style={{ color: resolveColor(overlay.muted, overlay.rowText || overlay.text || undefined) }}
                            >
                                -
                            </td>
                        </tr>
                    ))
                )}
                {displayResults.length === 0 && (!currentRaceResults || currentRaceResults.length === 0) && (
                    <tr>
                        <td
                            colSpan={totalColumns}
                            className="py-8 text-center text-slate-500 text-xl italic"
                            style={{ color: resolveColor(overlay.muted, overlay.text || undefined) }}
                        >
                            No standings available for category '{category}'.
                        </td>
                    </tr>
                )}
            </tbody>
        </table>
    );
}
