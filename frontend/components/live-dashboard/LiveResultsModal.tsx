'use client';

import type { LiveRace } from '@/hooks/useLiveRaces';

interface LiveResultsModalProps {
    race: LiveRace | null;
    processingKey: string | null;
    onClose: () => void;
    onRefresh: (raceId: string, category: string) => Promise<void>;
    onToggleDQ: (raceId: string, zwiftId: string, isCurrentlyDQ: boolean) => Promise<void>;
    onToggleDeclass: (raceId: string, zwiftId: string, isCurrentlyDeclass: boolean) => Promise<void>;
    onToggleExclude: (raceId: string, zwiftId: string, isCurrentlyExcluded: boolean) => Promise<void>;
}

export default function LiveResultsModal({
    race,
    processingKey,
    onClose,
    onRefresh,
    onToggleDQ,
    onToggleDeclass,
    onToggleExclude,
}: LiveResultsModalProps) {
    if (!race) return null;

    const results = race.results || {};
    const categories = Object.keys(results).sort();

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-slate-900 w-full max-w-5xl max-h-[90vh] overflow-hidden rounded-lg shadow-2xl border border-slate-700 flex flex-col">
                <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-800">
                    <div className="flex items-center gap-4">
                        <h3 className="text-lg font-bold text-slate-100">
                            Results: {race.name}
                        </h3>
                        <button 
                            onClick={() => onRefresh(race.id, 'All')}
                            disabled={!!processingKey}
                            className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-500 font-medium"
                        >
                            {processingKey === `${race.id}-All` ? 'Calculating...' : 'Recalculate Results'}
                        </button>
                    </div>
                    <button 
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-100 p-1"
                    >
                        ✕
                    </button>
                </div>
                <div className="overflow-y-auto p-4 space-y-6">
                    {/* Excluded Riders Section */}
                    {(race.manualExclusions || []).length > 0 && (
                        <div className="border border-slate-700 rounded-lg p-3 bg-slate-800/40 text-xs">
                            <div className="font-semibold text-slate-400 mb-2">Excluded Riders</div>
                            <div className="flex flex-wrap gap-2">
                                {(race.manualExclusions || []).map((zid: string) => (
                                    <button
                                        key={zid}
                                        onClick={() => onToggleExclude(race.id, zid, true)}
                                        className="px-2 py-1 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-400"
                                        title="Remove exclusion"
                                    >
                                        {zid} ×
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {categories.length === 0 ? (
                        <div className="text-center text-slate-400 p-8">No results calculated yet.</div>
                    ) : (
                        categories.map(cat => (
                            <CategoryResultsTable
                                key={cat}
                                category={cat}
                                results={results[cat]}
                                race={race}
                                onToggleDQ={onToggleDQ}
                                onToggleDeclass={onToggleDeclass}
                                onToggleExclude={onToggleExclude}
                            />
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}

// Category Results Modal for viewing all races in a category
interface CategoryResultsModalProps {
    category: string | null;
    races: LiveRace[];
    processingKey: string | null;
    processingCategory: string | null;
    onClose: () => void;
    onRefresh: (raceId: string, category: string) => Promise<void>;
    onRefreshCategory: (category: string) => Promise<void>;
    onToggleDQ: (raceId: string, zwiftId: string, isCurrentlyDQ: boolean) => Promise<void>;
    onToggleDeclass: (raceId: string, zwiftId: string, isCurrentlyDeclass: boolean) => Promise<void>;
    onToggleExclude: (raceId: string, zwiftId: string, isCurrentlyExcluded: boolean) => Promise<void>;
}

export function CategoryResultsModal({
    category,
    races,
    processingKey,
    processingCategory,
    onClose,
    onRefresh,
    onRefreshCategory,
    onToggleDQ,
    onToggleDeclass,
    onToggleExclude,
}: CategoryResultsModalProps) {
    if (!category) return null;

    const relevantRaces = races.filter(
        r => r.results && r.results[category] && r.results[category].length > 0
    );

    const isProcessingAll = processingCategory === category;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-slate-900 w-full max-w-5xl max-h-[90vh] overflow-hidden rounded-lg shadow-2xl border border-slate-700 flex flex-col">
                <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-800">
                    <div className="flex items-center gap-4">
                        <h3 className="text-lg font-bold text-slate-100">
                            Results: Category {category}
                        </h3>
                        <button 
                            onClick={() => onRefreshCategory(category)}
                            disabled={!!processingKey || !!processingCategory}
                            className={`text-xs px-3 py-1 rounded font-medium transition-colors ${
                                isProcessingAll
                                    ? 'bg-slate-700 text-slate-400 cursor-wait'
                                    : 'bg-blue-600 text-white hover:bg-blue-500'
                            }`}
                        >
                            {isProcessingAll ? 'Calculating All...' : 'Recalculate All'}
                        </button>
                    </div>
                    <button 
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-100 p-1"
                    >
                        ✕
                    </button>
                </div>
                <div className="overflow-y-auto p-4 space-y-8">
                    {relevantRaces.length === 0 ? (
                        <div className="text-center text-slate-400 p-8">
                            No results calculated for this category yet.
                        </div>
                    ) : (
                        relevantRaces.map(race => (
                            <div key={race.id} className="border border-slate-700 rounded-lg overflow-hidden">
                                <div className="bg-slate-800 px-4 py-2 font-semibold text-sm border-b border-slate-700 flex justify-between items-center">
                                    <span>{race.name}</span>
                                    <div className="flex items-center gap-3">
                                        <button 
                                            onClick={() => onRefresh(race.id, category)}
                                            disabled={!!processingKey || !!processingCategory}
                                            className={`text-xs px-2 py-1 rounded font-medium transition-colors ${
                                                processingKey === `${race.id}-${category}`
                                                    ? 'bg-slate-700 text-slate-400 cursor-wait'
                                                    : 'bg-blue-600 text-white hover:bg-blue-500'
                                            }`}
                                        >
                                            {processingKey === `${race.id}-${category}` ? 'Calculating...' : 'Recalc'}
                                        </button>
                                        <span className="text-xs text-slate-400">
                                            {new Date(race.date).toLocaleDateString()}
                                        </span>
                                    </div>
                                </div>
                                
                                {/* Excluded Riders for this race */}
                                {(race.manualExclusions || []).length > 0 && (
                                    <div className="px-4 py-2 bg-slate-800/40 border-b border-slate-700 text-xs">
                                        <span className="font-semibold text-slate-400 mr-2">Excluded:</span>
                                        <span className="text-slate-500">
                                            {(race.manualExclusions || []).map((zid: string, idx: number) => (
                                                <button
                                                    key={zid}
                                                    onClick={() => onToggleExclude(race.id, zid, true)}
                                                    className="inline-flex items-center px-1.5 py-0.5 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-400 mr-1"
                                                    title="Remove exclusion"
                                                >
                                                    {zid} ×
                                                </button>
                                            ))}
                                        </span>
                                    </div>
                                )}
                                
                                <CategoryResultsTable
                                    category={category}
                                    results={race.results?.[category] || []}
                                    race={race}
                                    onToggleDQ={onToggleDQ}
                                    onToggleDeclass={onToggleDeclass}
                                    onToggleExclude={onToggleExclude}
                                    compact
                                />
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}

// Shared Category Results Table
interface CategoryResultsTableProps {
    category: string;
    results: any[];
    race: LiveRace;
    onToggleDQ: (raceId: string, zwiftId: string, isCurrentlyDQ: boolean) => Promise<void>;
    onToggleDeclass: (raceId: string, zwiftId: string, isCurrentlyDeclass: boolean) => Promise<void>;
    onToggleExclude: (raceId: string, zwiftId: string, isCurrentlyExcluded: boolean) => Promise<void>;
    compact?: boolean;
}

function CategoryResultsTable({
    category,
    results,
    race,
    onToggleDQ,
    onToggleDeclass,
    onToggleExclude,
    compact = false,
}: CategoryResultsTableProps) {
    return (
        <div className={compact ? '' : 'border border-slate-700 rounded-lg overflow-hidden'}>
            {!compact && (
                <div className="bg-slate-800 px-4 py-2 font-semibold text-sm border-b border-slate-700">
                    {category}
                </div>
            )}
            <table className="w-full text-left text-sm">
                <thead className="bg-slate-800/50 text-xs text-slate-400">
                    <tr>
                        <th className="px-4 py-2 w-12">Pos</th>
                        <th className="px-4 py-2">Rider</th>
                        <th className="px-4 py-2 text-right">Time</th>
                        <th className="px-4 py-2 text-right">Pts</th>
                        <th className="px-4 py-2 text-center w-12" title="Disqualify (0 pts)">DQ</th>
                        <th className="px-4 py-2 text-center w-12" title="Declassify (Last place pts)">DC</th>
                        <th className="px-4 py-2 text-center w-12" title="Exclude from results">EX</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                    {results.map((rider: any, idx: number) => {
                        const isManualDQ = (race.manualDQs || []).includes(rider.zwiftId);
                        const isManualDeclass = (race.manualDeclassifications || []).includes(rider.zwiftId);
                        const isManualExcluded = (race.manualExclusions || []).includes(rider.zwiftId);

                        let rowClass = 'hover:bg-slate-800/50';
                        if (isManualExcluded) {
                            rowClass += ' bg-slate-800/30';
                        } else if (isManualDQ) {
                            rowClass += ' bg-red-950/30';
                        } else if (isManualDeclass) {
                            rowClass += ' bg-yellow-950/20';
                        }

                        return (
                            <tr key={rider.zwiftId} className={rowClass}>
                                <td className="px-4 py-2 text-slate-400">
                                    {isManualExcluded ? '×' : isManualDQ ? '-' : isManualDeclass ? '*' : idx + 1}
                                </td>
                                <td className="px-4 py-2 font-medium">
                                    {rider.name}
                                    {isManualExcluded && (
                                        <div className="text-[10px] text-slate-400 font-bold mt-0.5">EXCLUDED</div>
                                    )}
                                    {isManualDQ && (
                                        <div className="text-[10px] text-red-500 font-bold mt-0.5">DISQUALIFIED</div>
                                    )}
                                    {isManualDeclass && (
                                        <div className="text-[10px] text-yellow-500 font-bold mt-0.5">DECLASSIFIED</div>
                                    )}
                                </td>
                                <td className="px-4 py-2 text-right font-mono text-slate-400">
                                    {rider.finishTime > 0 
                                        ? new Date(rider.finishTime).toISOString().substr(11, 8) 
                                        : '-'
                                    }
                                </td>
                                <td className="px-4 py-2 text-right font-bold text-blue-400">
                                    {rider.totalPoints}
                                    {(isManualExcluded || (isManualDQ && rider.totalPoints > 0) || (isManualDeclass && rider.totalPoints === 0)) && (
                                        <span className="text-[10px] text-red-500 block" title="Recalculation needed">
                                            (Recalc)
                                        </span>
                                    )}
                                </td>
                                <td className="px-4 py-2 text-center">
                                    <input 
                                        type="checkbox"
                                        checked={isManualDQ}
                                        onChange={() => onToggleDQ(race.id, rider.zwiftId, isManualDQ)}
                                        disabled={isManualDeclass || isManualExcluded}
                                        title={isManualExcluded ? "Excluded" : isManualDeclass ? "Uncheck DC first" : "Disqualify"}
                                        className="w-4 h-4 rounded border-slate-700 text-blue-500 focus:ring-blue-500 cursor-pointer disabled:opacity-30"
                                    />
                                </td>
                                <td className="px-4 py-2 text-center">
                                    <input 
                                        type="checkbox"
                                        checked={isManualDeclass}
                                        onChange={() => onToggleDeclass(race.id, rider.zwiftId, isManualDeclass)}
                                        disabled={isManualDQ || isManualExcluded}
                                        title={isManualExcluded ? "Excluded" : isManualDQ ? "Uncheck DQ first" : "Declassify"}
                                        className="w-4 h-4 rounded border-slate-700 text-yellow-500 focus:ring-yellow-500 cursor-pointer disabled:opacity-30"
                                    />
                                </td>
                                <td className="px-4 py-2 text-center">
                                    <input 
                                        type="checkbox"
                                        checked={isManualExcluded}
                                        onChange={() => onToggleExclude(race.id, rider.zwiftId, isManualExcluded)}
                                        title={isManualExcluded ? "Include" : "Exclude"}
                                        className="w-4 h-4 rounded border-slate-700 text-slate-400 focus:ring-slate-500 cursor-pointer"
                                    />
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
