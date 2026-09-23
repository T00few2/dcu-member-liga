import type { Race, StandingEntry } from '@/types/live';
import {
    buildLegacyStandingColumns,
    columnMatchesResult,
    type SeasonStandingColumn,
} from '@/lib/seasonUi';

const DIVISION_LEADER_JERSEY_URL =
    'https://cdn.zwift.com/static/zc/JERSEYS/DanishCyclingMember2019_thumb.png';

const DEFAULT_LEADER_JERSEY: StandingJersey = {
    src: DIVISION_LEADER_JERSEY_URL,
    alt: 'Danish Cycling Member',
    title: 'Fører i divisionen må køre i Danish Cycling Member',
};

export type StandingJersey = {
    src: string;
    alt: string;
    title: string;
};

type ProcessedRider = StandingEntry & {
    calculatedTotal: number;
    countingKeys: Set<string>;
};

interface Props {
    currentStandings: ProcessedRider[];
    /** @deprecated Prefer `columns`. Used as fallback for Historik / legacy. */
    races?: Race[];
    columns?: SeasonStandingColumn[];
    availableStandingsCategories: string[];
    displayStandingsCategory: string;
    standingsCategory: string;
    setStandingsCategory: (cat: string) => void;
    clubByZwiftId?: Map<string, string>;
    title?: string;
    countingHint?: string;
    /** Season division leader may wear the individual classification jersey. */
    showDivisionLeaderJersey?: boolean;
    /** Replaces the default Danish Cycling Member image when set. */
    leaderJersey?: StandingJersey;
    /** Shown beside the division sprint leader. Omitted until a jersey is chosen. */
    sprintJersey?: StandingJersey | null;
    /** Shown beside the division KOM leader. Omitted until a jersey is chosen. */
    komJersey?: StandingJersey | null;
    /** Sprint leaders after last-race tiebreaks. Falls back to equal points when omitted. */
    sprintLeaderIds?: Set<string>;
    /** KOM leaders after last-race tiebreaks. Falls back to equal points when omitted. */
    komLeaderIds?: Set<string>;
    /** Classification-tab leaders. Falls back to equal totals when omitted. */
    leaderIds?: Set<string>;
    totalLabel?: string;
}

export default function StandingsTable({
    currentStandings,
    races = [],
    columns: columnsProp,
    availableStandingsCategories,
    displayStandingsCategory,
    standingsCategory,
    setStandingsCategory,
    clubByZwiftId,
    title = 'Førertavle',
    countingHint = 'Tæller ikke (uden for best-X)',
    showDivisionLeaderJersey = false,
    leaderJersey,
    sprintJersey = null,
    komJersey = null,
    sprintLeaderIds,
    komLeaderIds,
    leaderIds,
    totalLabel = 'Samlede point',
}: Props) {
    const columns = columnsProp?.length
        ? columnsProp
        : buildLegacyStandingColumns(races);
    const leaderPoints = currentStandings[0]?.calculatedTotal;
    const individualJersey = leaderJersey ?? DEFAULT_LEADER_JERSEY;
    const sprintLeaderPoints = maxPoints(currentStandings, 'sprintPoints');
    const komLeaderPoints = maxPoints(currentStandings, 'komPoints');

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold text-card-foreground">{title}</h2>
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
                                    <th className="px-4 py-3">Klub</th>
                                    <th className="px-4 py-3 text-center">Resultater</th>
                                    {columns.map((col) => (
                                        <th
                                            key={col.key}
                                            className="px-2 py-3 text-center text-xs font-medium text-muted-foreground whitespace-normal min-w-[60px]"
                                        >
                                            {col.label}
                                        </th>
                                    ))}
                                    <th className="px-4 py-3 text-right font-bold text-primary">{totalLabel}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {currentStandings.map((rider, idx) => (
                                    <tr key={rider.zwiftId} className="hover:bg-muted/20 transition odd:bg-transparent even:bg-[#f1efe7]">
                                        <td className="px-4 py-3 text-center font-medium text-muted-foreground">
                                            {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                                        </td>
                                        <td className="px-4 py-3 font-medium text-card-foreground whitespace-normal">
                                            <span className="flex flex-col items-start gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
                                                <span>{rider.name}</span>
                                                {showDivisionLeaderJersey && wearsJersey(rider, leaderIds, leaderPoints) && (
                                                    <JerseyIcon jersey={individualJersey} />
                                                )}
                                                {sprintJersey && wearsClassJersey(rider, sprintLeaderIds, 'sprintPoints', sprintLeaderPoints) && (
                                                    <JerseyIcon jersey={sprintJersey} />
                                                )}
                                                {komJersey && wearsClassJersey(rider, komLeaderIds, 'komPoints', komLeaderPoints) && (
                                                    <JerseyIcon jersey={komJersey} />
                                                )}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-muted-foreground">{clubByZwiftId?.get(rider.zwiftId) || '-'}</td>
                                        <td className="px-4 py-3 text-center text-muted-foreground">{rider.raceCount}</td>
                                        {columns.map((col) => {
                                            const result = rider.results.find((r) => columnMatchesResult(col, r));
                                            const isCounting = result ? rider.countingKeys.has(col.key) : false;
                                            return (
                                                <td
                                                    key={col.key}
                                                    className={`px-2 py-3 text-center text-sm ${result
                                                        ? isCounting
                                                            ? 'text-foreground font-medium'
                                                            : 'text-muted-foreground/50 line-through'
                                                        : 'text-muted-foreground'
                                                        }`}
                                                    title={result && !isCounting ? countingHint : undefined}
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

function wearsJersey(rider: ProcessedRider, leaderIds: Set<string> | undefined, leaderPoints: number | undefined): boolean {
    if (leaderIds) return leaderIds.has(rider.zwiftId);
    return leaderPoints !== undefined && rider.calculatedTotal === leaderPoints;
}

function wearsClassJersey(
    rider: ProcessedRider,
    leaderIds: Set<string> | undefined,
    field: 'sprintPoints' | 'komPoints',
    leaderPoints: number,
): boolean {
    if (leaderIds) return leaderIds.has(rider.zwiftId);
    return leaderPoints > 0 && (rider[field] ?? 0) === leaderPoints;
}

function maxPoints(riders: ProcessedRider[], field: 'sprintPoints' | 'komPoints'): number {
    let max = 0;
    for (const rider of riders) {
        const value = Number(rider[field]) || 0;
        if (value > max) max = value;
    }
    return max;
}

function JerseyIcon({ jersey }: { jersey: StandingJersey }) {
    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src={jersey.src}
            alt={jersey.alt}
            title={jersey.title}
            className="w-8 h-8 sm:w-10 sm:h-10 object-contain shrink-0"
        />
    );
}
