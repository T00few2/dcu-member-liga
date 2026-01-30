import { Race, ResultEntry, Sprint, OverlayConfig } from '@/types/live';
import { formatTimeValue, formatDelta, shortenRiderName, parseWorldTime } from '@/lib/formatters';
import { resolveColor } from '@/lib/colors';

interface RaceResultsTableProps {
    race: Race;
    results: ResultEntry[];
    category: string;
    config: {
        showSprints: boolean;
        showLastSprint: boolean;
        isFull: boolean;
        nameMax: number;
    };
    overlay: OverlayConfig;
}

export function RaceResultsTable({ race, results, category, config, overlay }: RaceResultsTableProps) {
    const { showSprints, showLastSprint, isFull, nameMax } = config;

    // Sprint Columns Logic
    const allSprintKeys = new Set<string>();
    if (showSprints || showLastSprint) {
        results.forEach(r => {
            if (r.sprintDetails) {
                Object.keys(r.sprintDetails).forEach(k => allSprintKeys.add(k));
            }
        });
    }

    let configuredSegments: Sprint[] = [];
    let segmentType: 'sprint' | 'split' = race.segmentType || 'sprint';

    if (race.eventMode === 'multi' && race.eventConfiguration) {
        const catConfig = race.eventConfiguration.find(c => c.customCategory === category);
        if (catConfig && catConfig.sprints && catConfig.sprints.length > 0) {
            configuredSegments = catConfig.sprints;
            segmentType = catConfig.segmentType || segmentType;
        } else {
            configuredSegments = race.sprints || [];
        }
    } else {
        if (race.singleModeCategories && race.singleModeCategories.length > 0) {
            const catConfig = race.singleModeCategories.find(c => c.category === category);
            if (catConfig && catConfig.sprints && catConfig.sprints.length > 0) {
                configuredSegments = catConfig.sprints;
                segmentType = catConfig.segmentType || segmentType;
            } else {
                configuredSegments = race.sprints || race.sprintData || [];
            }
        } else {
            configuredSegments = race.sprints || race.sprintData || [];
        }
    }

    const isSplitResults = segmentType === 'split';
    const sprintSegments = configuredSegments.filter(s => s.type !== 'split');
    const splitSegments = configuredSegments.filter(s => s.type === 'split');
    const activeSegments = isSplitResults
        ? (splitSegments.length > 0 ? splitSegments : configuredSegments)
        : sprintSegments;

    let sprintColumns: string[] = [];
    const remainingSprintKeys = new Set(allSprintKeys);

    if (activeSegments.length > 0) {
        activeSegments.forEach(s => {
            const potentialKeys = [s.key, `${s.id}_${s.count}`, `${s.id}`];
            const foundKey = potentialKeys.find(k => k && remainingSprintKeys.has(k));
            if (foundKey) {
                sprintColumns.push(foundKey);
                remainingSprintKeys.delete(foundKey);
            }
        });
    }

    if (remainingSprintKeys.size > 0) {
        sprintColumns = [...sprintColumns, ...Array.from(remainingSprintKeys).sort()];
    }

    if (showLastSprint && sprintColumns.length > 0) {
        sprintColumns = [sprintColumns[sprintColumns.length - 1]];
    } else if (!showSprints) {
        sprintColumns = [];
    }

    const isPointsRace = race.type === 'points';
    const isPointsRaceOverlay = isPointsRace && !isFull;
    if (isPointsRaceOverlay) {
        sprintColumns = [];
    }

    // Points Race Full Screen Logic
    const isPointsRaceFull = isPointsRace && isFull;
    const riderColumnWidth = isPointsRaceFull ? (sprintColumns.length > 0 ? 'w-[25%]' : 'w-[40%]') : (sprintColumns.length > 0 ? 'w-[40%]' : 'w-[50%]');

    const getSprintHeader = (key: string) => {
        const sprint = activeSegments.find(s => s.key === key || `${s.id}_${s.count}` === key || s.id === key);
        if (sprint) return `${sprint.name} #${sprint.count}`;
        
        if (race.sprints) {
            const globalSprint = race.sprints.find(s => s.key === key || `${s.id}_${s.count}` === key || s.id === key);
            if (globalSprint) return `${globalSprint.name} #${globalSprint.count}`;
        }
        return key;
    };

    const minWorldTimes = new Map<string, number>();
    if (isSplitResults && sprintColumns.length > 0) {
        sprintColumns.forEach(key => {
            const times = results
                .map(r => parseWorldTime(r.sprintDetails?.[key]))
                .filter((v): v is number => v !== null);
            if (times.length > 0) {
                minWorldTimes.set(key, Math.min(...times));
            }
        });
    }

    const formatSprintValue = (value: unknown, key: string) => {
        if (value === null || value === undefined || value === '') return '-';
        if (!isSplitResults) return value as any;
        const parsed = parseWorldTime(value);
        if (parsed === null) return '-';
        const min = minWorldTimes.get(key);
        if (min === undefined || parsed === min) return formatTimeValue(parsed);
        return formatDelta(parsed - min);
    };

    const hasAnyFinisher = results.some(r => r.finishTime && r.finishTime > 0);
    const winnerFinishTime = hasAnyFinisher
        ? Math.min(
            ...results
                .filter(r => r.finishTime && r.finishTime > 0)
                .map(r => r.finishTime)
        )
        : 0;

    const formatFinishTimeOrDelta = (finishTime: number, isWinner: boolean) => {
        if (!finishTime || finishTime <= 0) return '-';
        if (isWinner || finishTime === winnerFinishTime) {
            return formatTimeValue(finishTime);
        }
        return formatDelta(finishTime - winnerFinishTime);
    };

    const showTotalPoints = (sprintColumns.length > 0 && !isSplitResults) || isPointsRaceOverlay;
    const showFinishTime = (sprintColumns.length === 0 || isSplitResults) && !isPointsRaceOverlay;
    const showLeaguePoints = isFull;

    // Styling
    const headerCellPadding = isFull ? 'py-0' : 'py-1';
    const bodyCellPadding = isFull ? 'py-0.5' : 'py-2';
    const tableBodyTextSize = isFull ? 'text-2xl' : 'text-3xl';
    const leaguePointsHeaderClass = isFull ? 'text-slate-100' : 'text-blue-300';
    const leaguePointsCellClass = isFull ? 'text-slate-100' : 'text-blue-300';

    return (
        <table className="w-full text-left border-collapse table-fixed">
            <thead>
                <tr
                    className="text-slate-400 text-lg uppercase tracking-wider border-b-2 border-slate-600 bg-slate-800/80"
                    style={{
                        backgroundColor: resolveColor(overlay.headerBg),
                        color: resolveColor(overlay.headerText, overlay.text),
                        borderColor: resolveColor(overlay.border)
                    }}
                >
                    <th
                        className={`sticky top-0 z-10 bg-slate-800/90 ${headerCellPadding} px-2 w-[10%] text-center`}
                        style={{ backgroundColor: resolveColor(overlay.headerBg) }}
                    >
                        #
                    </th>
                    <th
                        className={`sticky top-0 z-10 bg-slate-800/90 ${headerCellPadding} px-2 ${riderColumnWidth}`}
                        style={{ backgroundColor: resolveColor(overlay.headerBg) }}
                    >
                        Rider
                    </th>
                    {sprintColumns.length > 0 ? (
                        <>
                            {sprintColumns.map(key => (
                            <th
                                key={key}
                                className={`sticky top-0 z-10 bg-slate-800/90 ${headerCellPadding} px-2 text-center font-bold break-words text-blue-400`}
                                style={{
                                    backgroundColor: resolveColor(overlay.headerBg),
                                    color: resolveColor(overlay.accent, overlay.headerText || overlay.text || undefined)
                                }}
                            >
                                {getSprintHeader(key)}
                            </th>
                            ))}
                            {showTotalPoints && (
                                <th
                                    className={`sticky top-0 z-10 bg-slate-800/90 ${headerCellPadding} px-2 text-right font-bold text-blue-300`}
                                    style={{
                                        backgroundColor: resolveColor(overlay.headerBg),
                                        color: resolveColor(overlay.accent, overlay.headerText || overlay.text || undefined)
                                    }}
                                >
                                    Total
                                </th>
                            )}
                            {showFinishTime && (
                                <th
                                    className={`sticky top-0 z-10 bg-slate-800/90 ${headerCellPadding} px-2 text-right font-bold text-green-300`}
                                    style={{
                                        backgroundColor: resolveColor(overlay.headerBg),
                                        color: resolveColor(overlay.positive, overlay.headerText || overlay.text || undefined)
                                    }}
                                >
                                    Finish Time
                                </th>
                            )}
                            {showLeaguePoints && (
                                <th
                                    className={`sticky top-0 z-10 bg-slate-800/90 ${headerCellPadding} px-2 text-right font-bold ${leaguePointsHeaderClass}`}
                                    style={{
                                        backgroundColor: resolveColor(overlay.headerBg),
                                        color: resolveColor(overlay.headerText, overlay.text)
                                    }}
                                >
                                    League Pts
                                </th>
                            )}
                        </>
                    ) : (
                        <>
                            {showTotalPoints && (
                                <th
                                    className={`sticky top-0 z-10 bg-slate-800/90 ${headerCellPadding} px-2 text-right font-bold text-blue-300`}
                                    style={{
                                        backgroundColor: resolveColor(overlay.headerBg),
                                        color: resolveColor(overlay.accent, overlay.headerText || overlay.text || undefined)
                                    }}
                                >
                                    Total
                                </th>
                            )}
                            {showFinishTime && (
                                <th
                                    className={`sticky top-0 z-10 bg-slate-800/90 ${headerCellPadding} px-2 w-[35%] text-right font-bold break-words text-green-300`}
                                    style={{
                                        backgroundColor: resolveColor(overlay.headerBg),
                                        color: resolveColor(overlay.positive, overlay.headerText || overlay.text || undefined)
                                    }}
                                >
                                    Finish Time
                                </th>
                            )}
                            {showLeaguePoints && (
                                <th
                                    className={`sticky top-0 z-10 bg-slate-800/90 ${headerCellPadding} px-2 w-[35%] text-right font-bold break-words ${leaguePointsHeaderClass}`}
                                    style={{
                                        backgroundColor: resolveColor(overlay.headerBg),
                                        color: resolveColor(overlay.headerText, overlay.text)
                                    }}
                                >
                                    League Pts
                                </th>
                            )}
                        </>
                    )}
                </tr>
            </thead>
            <tbody
                className={`text-white font-bold ${tableBodyTextSize}`}
                style={{ color: resolveColor(overlay.rowText, overlay.text) }}
            >
                {results.map((rider, idx) => (
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
                            className={`${bodyCellPadding} px-2 text-center font-bold text-slate-300 align-middle`}
                            style={{ color: resolveColor(overlay.muted, overlay.rowText || overlay.text || undefined) }}
                        >
                            {idx + 1}
                        </td>
                        <td className={`${bodyCellPadding} px-2 truncate align-middle`}>
                            {shortenRiderName(rider.name, nameMax)}
                        </td>
                        {sprintColumns.length > 0 ? (
                            <>
                                {sprintColumns.map(key => (
                                    <td
                                        key={key}
                                        className={`${bodyCellPadding} px-2 text-center font-extrabold text-blue-400 align-middle`}
                                        style={{ color: resolveColor(overlay.accent, overlay.rowText || overlay.text || undefined) }}
                                    >
                                        {formatSprintValue(rider.sprintDetails?.[key], key)}
                                    </td>
                                ))}
                                {showTotalPoints && (
                                    <td
                                        className={`${bodyCellPadding} px-2 text-right font-extrabold text-blue-300 align-middle`}
                                        style={{ color: resolveColor(overlay.accent, overlay.rowText || overlay.text || undefined) }}
                                    >
                                        {rider.totalPoints ?? 0}
                                    </td>
                                )}
                                {showFinishTime && (
                                    <td
                                        className={`${bodyCellPadding} px-2 text-right font-extrabold text-green-300 align-middle`}
                                        style={{ color: resolveColor(overlay.positive, overlay.rowText || overlay.text || undefined) }}
                                    >
                                        {formatFinishTimeOrDelta(rider.finishTime, rider.finishTime === winnerFinishTime)}
                                    </td>
                                )}
                                {showLeaguePoints && (
                                    <td
                                        className={`${bodyCellPadding} px-2 text-right font-extrabold ${leaguePointsCellClass} align-middle`}
                                        style={{ color: resolveColor(overlay.rowText, overlay.text) }}
                                    >
                                        {rider.leaguePoints != null ? rider.leaguePoints : '-'}
                                    </td>
                                )}
                            </>
                        ) : (
                            <>
                                {showTotalPoints && (
                                    <td
                                        className={`${bodyCellPadding} px-2 text-right font-extrabold text-blue-300 align-middle`}
                                        style={{ color: resolveColor(overlay.accent, overlay.rowText || overlay.text || undefined) }}
                                    >
                                        {rider.totalPoints ?? 0}
                                    </td>
                                )}
                                {showFinishTime && (
                                    <td
                                        className={`${bodyCellPadding} px-2 text-right font-extrabold text-green-300 align-middle`}
                                        style={{ color: resolveColor(overlay.positive, overlay.rowText || overlay.text || undefined) }}
                                    >
                                        {formatFinishTimeOrDelta(rider.finishTime, rider.finishTime === winnerFinishTime)}
                                    </td>
                                )}
                                {showLeaguePoints && (
                                    <td
                                        className={`${bodyCellPadding} px-2 text-right font-extrabold ${leaguePointsCellClass} align-middle`}
                                        style={{ color: resolveColor(overlay.rowText, overlay.text) }}
                                    >
                                        {rider.leaguePoints != null ? rider.leaguePoints : '-'}
                                    </td>
                                )}
                            </>
                        )}
                    </tr>
                ))}
                {results.length === 0 && (
                    <tr>
                        <td
                            colSpan={3}
                            className="py-8 text-center text-slate-500 text-xl italic"
                            style={{ color: resolveColor(overlay.muted, overlay.text || undefined) }}
                        >
                            Waiting for results...
                        </td>
                    </tr>
                )}
            </tbody>
        </table>
    );
}
