'use client';

import { useState } from 'react';
import type { Race, Sprint, ResultEntry, DualRecordingVerification } from '@/types/live';
import { formatDateShort } from '@/lib/formatDate';
import { formatTime, formatGap } from './formatTime';
import DualRecordingStatusBadge from '@/components/DualRecordingStatusBadge';
import DualRecordingResultModal from '@/components/DualRecordingResultModal';

interface Props {
    races: Race[];
    selectedRaceId: string;
    setSelectedRaceId: (id: string) => void;
    selectedRace: Race | undefined;
    availableRaceCategories: string[];
    displayRaceCategory: string;
    selectedCategory: string;
    setSelectedCategory: (cat: string) => void;
    displayLaps: number | undefined;
    raceResults: ResultEntry[];
    sprintColumns: string[];
    bestSplitTimes: Record<string, number>;
    getSprintHeader: (key: string) => string;
    leaguePointsByZwiftId?: Map<string, number>;
    drVerifications?: Map<string, DualRecordingVerification>;
}

export default function RaceResultsTable({
    races,
    selectedRaceId,
    setSelectedRaceId,
    selectedRace,
    availableRaceCategories,
    displayRaceCategory,
    selectedCategory,
    setSelectedCategory,
    displayLaps,
    raceResults,
    sprintColumns,
    bestSplitTimes,
    getSprintHeader,
    leaguePointsByZwiftId,
    drVerifications,
}: Props) {
    const [drModal, setDrModal] = useState<{ name: string; verification: DualRecordingVerification } | null>(null);

    const showFinishPointsColumn = raceResults.some(r => (r.finishPoints ?? 0) > 0);
    const showTotalPointsColumn = raceResults.some(r => (r.totalPoints ?? 0) > 0);
    const showLeaguePointsColumn = !!leaguePointsByZwiftId && raceResults.some(r => leaguePointsByZwiftId.has(r.zwiftId));
    const showDrColumn = !!drVerifications && drVerifications.size > 0;

    return (
        <>
        <div className="space-y-6">
            {/* Race Selector */}
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between bg-card border border-border p-4 rounded-lg shadow-sm">
                <div className="flex flex-col gap-1 w-full sm:w-auto">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Vælg løb</label>
                    <select
                        value={selectedRaceId}
                        onChange={(e) => setSelectedRaceId(e.target.value)}
                        className="bg-background border border-input rounded px-3 py-2 text-foreground font-medium w-full sm:w-80"
                    >
                        {races.map(r => (
                            <option key={r.id} value={r.id}>
                                {formatDateShort(r.date)} - {r.name}
                            </option>
                        ))}
                        {races.length === 0 && <option>Ingen løb fundet</option>}
                    </select>
                </div>

                {selectedRace && (
                    <div className="text-right hidden sm:block">
                        <div className="text-sm font-medium text-card-foreground">{selectedRace.map}</div>
                        <div className="text-xs text-muted-foreground">{selectedRace.routeName} • {displayLaps} omgange</div>
                    </div>
                )}
            </div>

            {/* Category Tabs */}
            <div className="flex gap-2 border-b border-border pb-1 overflow-x-auto">
                {availableRaceCategories.map(cat => (
                    <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        className={`px-4 py-2 rounded-t-md font-bold text-sm transition-colors whitespace-nowrap ${displayRaceCategory === cat
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                            }`}
                    >
                        {cat}
                    </button>
                ))}
            </div>

            {/* Results Table */}
            <div className="bg-card border border-border rounded-lg overflow-hidden shadow-sm">
                {raceResults.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-[#E7E3D6] text-slate-800 border-b-2 border-slate-300">
                                <tr>
                                    <th className="px-4 py-3 w-12 text-center">Pos</th>
                                    <th className="px-4 py-3">Rytter</th>
                                    <th className="px-4 py-3 text-right">Tid</th>
                                    {sprintColumns.map(sprintKey => (
                                        <th
                                            key={sprintKey}
                                            className="px-2 py-3 text-center text-xs uppercase tracking-wider text-muted-foreground/70 whitespace-normal sm:max-w-[120px] min-w-[80px]"
                                        >
                                            {getSprintHeader(sprintKey)}
                                        </th>
                                    ))}
                                    {showFinishPointsColumn && (
                                        <th className="px-4 py-3 text-right text-muted-foreground/70">Målpoint</th>
                                    )}
                                    {showTotalPointsColumn && (
                                        <th className="px-4 py-3 text-right font-bold text-primary">Total point</th>
                                    )}
                                    {showLeaguePointsColumn && (
                                        <th className="px-4 py-3 text-right font-bold text-primary">Ligapoint</th>
                                    )}
                                    {showDrColumn && (
                                        <th className="px-4 py-3 text-center w-12" title="Dual Recording">DR</th>
                                    )}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {raceResults.map((rider, idx) => {
                                    const drVerification = drVerifications?.get(rider.zwiftId);
                                    return (
                                    <tr key={rider.zwiftId} className="hover:bg-muted/20 transition odd:bg-transparent even:bg-[#f1efe7]">
                                        <td className="px-4 py-3 text-center font-medium text-muted-foreground">{idx + 1}</td>
                                        <td className="px-4 py-3 font-medium text-card-foreground">{rider.name}</td>
                                        <td className="px-4 py-3 text-right font-mono text-muted-foreground">{formatTime(rider.finishTime)}</td>
                                        {sprintColumns.map(sprintKey => {
                                            const val = rider.sprintDetails?.[sprintKey];
                                            const best = bestSplitTimes[sprintKey];

                                            let displayVal: React.ReactNode = '-';

                                            if (val !== undefined && val !== null) {
                                                if (best) {
                                                    const diff = (val as number) - best;
                                                    if (diff === 0) displayVal = <span className="text-green-600 dark:text-green-400 font-bold">0.00</span>;
                                                    else displayVal = <span className="text-red-500 dark:text-red-400">+{formatGap(diff)}</span>;
                                                } else {
                                                    displayVal = val;
                                                }
                                            }

                                            return (
                                                <td key={sprintKey} className="px-4 py-3 text-center text-muted-foreground">
                                                    {displayVal}
                                                </td>
                                            );
                                        })}
                                        {showFinishPointsColumn && (
                                            <td className="px-4 py-3 text-right text-muted-foreground font-medium">{rider.finishPoints}</td>
                                        )}
                                        {showTotalPointsColumn && (
                                            <td className="px-4 py-3 text-right font-bold text-foreground">{rider.totalPoints}</td>
                                        )}
                                        {showLeaguePointsColumn && (
                                            <td className="px-4 py-3 text-right font-bold text-foreground">
                                                {leaguePointsByZwiftId?.get(rider.zwiftId) ?? '-'}
                                            </td>
                                        )}
                                        {showDrColumn && (
                                            <td className="px-4 py-3 text-center">
                                                {drVerification && (
                                                    <DualRecordingStatusBadge
                                                        verification={drVerification}
                                                        onClick={() => setDrModal({ name: rider.name, verification: drVerification })}
                                                    />
                                                )}
                                            </td>
                                        )}
                                    </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="p-12 text-center">
                        <p className="text-muted-foreground mb-4">
                            Ingen resultater tilgængelige for <span className="font-semibold text-foreground">{selectedRace?.name}</span> ({displayRaceCategory})
                        </p>
                        {selectedRace?.eventId || (selectedRace?.eventConfiguration && selectedRace.eventConfiguration.length > 0) ? (
                            <div className="inline-block px-4 py-2 bg-primary/10 text-primary rounded text-sm">
                                Resultatbehandling afventer eller er ufuldstændig. Prøv igen senere.
                            </div>
                        ) : (
                            <div className="inline-block px-4 py-2 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded text-sm">
                                Begivenheds-ID er endnu ikke tilføjet. Resultater kan ikke hentes.
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
        {drModal && (
            <DualRecordingResultModal
                open
                onClose={() => setDrModal(null)}
                riderName={drModal.name}
                verification={drModal.verification}
            />
        )}
    </>
    );
}
