import { Race, ResultEntry, Sprint, OverlayConfig } from '@/types/live';
import { formatTimeValue, formatDelta, shortenRiderName, parseWorldTime } from '@/lib/formatters';
import { resolveColor } from '@/lib/colors';

interface TimeTrialTableProps {
    race: Race;
    results: ResultEntry[];
    category: string;
    config: {
        showLastSplit: boolean;
        isFull: boolean;
        nameMax: number;
    };
    overlay: OverlayConfig;
    standingsPoints: Map<string, number>;
}

export function TimeTrialTable({ race, results, category, config, overlay, standingsPoints }: TimeTrialTableProps) {
    const { showLastSplit, isFull, nameMax } = config;

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

    const splitSegments = segmentType === 'split'
        ? configuredSegments
        : configuredSegments.filter(s => s.type === 'split');

    const minWorldTimes = new Map<string, number>();
    const getWorldTimeForColumn = (rider: ResultEntry, columnKeys: string[]) => {
        for (const key of columnKeys) {
            const worldTime = parseWorldTime(rider.sprintDetails?.[key]);
            if (worldTime !== null) return worldTime;
        }
        return null;
    };

    let splitColumns = splitSegments.map((s) => ({
        label: `${s.name} #${s.count}`,
        keys: [s.key, `${s.id}_${s.count}`, `${s.id}`].filter(Boolean) as string[]
    }));

    const hasAnyFinisher = results.some(r => r.finishTime && r.finishTime > 0);
    const showFinishAsLastSplit = showLastSplit && hasAnyFinisher;

    if (showLastSplit && splitColumns.length > 0 && !showFinishAsLastSplit) {
        let lastWithData = -1;
        for (let i = splitColumns.length - 1; i >= 0; i--) {
            const col = splitColumns[i];
            const hasData = results.some(r => getWorldTimeForColumn(r, col.keys) !== null);
            if (hasData) {
                lastWithData = i;
                break;
            }
        }
        if (lastWithData >= 0) {
            splitColumns = [splitColumns[lastWithData]];
        }
    } else if (showFinishAsLastSplit) {
        splitColumns = [];
    }

    splitColumns.forEach(col => {
        const times = results
            .map(r => getWorldTimeForColumn(r, col.keys))
            .filter((v): v is number => v !== null);
        if (times.length > 0) {
            minWorldTimes.set(col.keys[0], Math.min(...times));
        }
    });

    const getLatestSplit = (rider: ResultEntry) => {
        for (let i = splitColumns.length - 1; i >= 0; i--) {
            const worldTime = getWorldTimeForColumn(rider, splitColumns[i].keys);
            if (worldTime !== null) {
                return { index: i, worldTime };
            }
        }
        return null;
    };

    // Sort
    const displayResults = [...results].sort((a, b) => {
        const aFinished = a.finishTime && a.finishTime > 0;
        const bFinished = b.finishTime && b.finishTime > 0;

        if (aFinished && bFinished) {
            return a.finishTime - b.finishTime;
        }
        if (aFinished) return -1;
        if (bFinished) return 1;

        const aLatest = getLatestSplit(a);
        const bLatest = getLatestSplit(b);

        if (aLatest && bLatest) {
            if (aLatest.index !== bLatest.index) {
                return bLatest.index - aLatest.index;
            }
            return aLatest.worldTime - bLatest.worldTime;
        }
        if (aLatest) return -1;
        if (bLatest) return 1;
        return 0;
    });

    const winnerFinishTime = hasAnyFinisher 
        ? Math.min(...displayResults.filter(r => r.finishTime > 0).map(r => r.finishTime))
        : 0;

    const formatFinishTime = (finishTime: number) => {
        if (!finishTime || finishTime <= 0) return '-';
        return formatTimeValue(finishTime);
    };

    const totalColumns = 2 + splitColumns.length + (hasAnyFinisher ? 1 : 0);
    const showNoSplitsMessage = displayResults.length > 0 && splitColumns.length === 0 && !showFinishAsLastSplit;

    const headerCellPadding = isFull ? 'py-0' : 'py-1';
    const bodyCellPadding = isFull ? 'py-0.5' : 'py-2';
    const tableBodyTextSize = isFull ? 'text-2xl' : 'text-3xl';
    const leaguePointsHeaderClass = isFull ? 'text-slate-100' : 'text-blue-300';
    const leaguePointsCellClass = isFull ? 'text-slate-100' : 'text-blue-300';

    return (
        <table className="w-full text-left border-collapse">
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
                        className={`sticky top-0 z-10 bg-slate-800/90 ${headerCellPadding} px-2 w-16 text-center`}
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
                    {splitColumns.map(col => {
                        return (
                            <th
                                key={col.keys[0]}
                                className={`sticky top-0 z-10 bg-slate-800/90 ${headerCellPadding} px-2 text-center text-blue-300 w-40`}
                                style={{
                                    backgroundColor: resolveColor(overlay.headerBg),
                                    color: resolveColor(overlay.accent, overlay.headerText || overlay.text || undefined)
                                }}
                            >
                                {col.label}
                            </th>
                        );
                    })}
                    {hasAnyFinisher && (
                        <th
                            className={`sticky top-0 z-10 bg-slate-800/90 ${headerCellPadding} px-2 text-center text-green-300 w-48`}
                            style={{
                                backgroundColor: resolveColor(overlay.headerBg),
                                color: resolveColor(overlay.positive, overlay.headerText || overlay.text || undefined)
                            }}
                        >
                            Finish Time
                        </th>
                    )}
                    {isFull && (
                        <th
                            className={`sticky top-0 z-10 bg-slate-800/90 ${headerCellPadding} px-2 text-right font-bold ${leaguePointsHeaderClass} w-32`}
                            style={{
                                backgroundColor: resolveColor(overlay.headerBg),
                                color: resolveColor(overlay.headerText, overlay.text)
                            }}
                        >
                            League Pts
                        </th>
                    )}
                </tr>
            </thead>
            <tbody
                className={`text-white font-bold ${tableBodyTextSize}`}
                style={{ color: resolveColor(overlay.rowText, overlay.text) }}
            >
                {displayResults.map((rider, idx) => {
                    const isWinner = rider.finishTime > 0 && rider.finishTime === winnerFinishTime;
                    return (
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
                            {splitColumns.map(col => {
                                const worldTime = getWorldTimeForColumn(rider, col.keys);
                                const minTime = minWorldTimes.get(col.keys[0]);
                                const delta = (worldTime !== null && minTime !== undefined) ? (worldTime - minTime) : null;
                                return (
                                    <td
                                        key={col.keys[0]}
                                        className={`${bodyCellPadding} px-2 text-center font-extrabold text-blue-300 align-middle`}
                                        style={{ color: resolveColor(overlay.accent, overlay.rowText || overlay.text || undefined) }}
                                    >
                                        {delta === null ? '-' : formatDelta(delta)}
                                    </td>
                                );
                            })}
                            {hasAnyFinisher && (
                                <td
                                    className={`${bodyCellPadding} px-2 text-center font-extrabold align-middle ${isWinner ? 'text-green-300' : 'text-green-400/80'}`}
                                    style={{ color: resolveColor(overlay.positive, overlay.rowText || overlay.text || undefined) }}
                                >
                                    {formatFinishTime(rider.finishTime)}
                                </td>
                            )}
                            {isFull && (
                                <td
                                    className={`${bodyCellPadding} px-2 text-right font-extrabold ${leaguePointsCellClass} align-middle`}
                                    style={{ color: resolveColor(overlay.rowText, overlay.text) }}
                                >
                                    {standingsPoints.get(rider.zwiftId) ?? '-'}
                                </td>
                            )}
                        </tr>
                    );
                })}
                {displayResults.length === 0 && (
                    <tr>
                        <td
                            colSpan={totalColumns + (isFull ? 1 : 0)}
                            className="py-8 text-center text-slate-500 text-xl italic"
                            style={{ color: resolveColor(overlay.muted, overlay.text || undefined) }}
                        >
                            No split results available.
                        </td>
                    </tr>
                )}
                {showNoSplitsMessage && (
                    <tr>
                        <td
                            colSpan={totalColumns + (isFull ? 1 : 0)}
                            className="py-8 text-center text-slate-500 text-xl italic"
                            style={{ color: resolveColor(overlay.muted, overlay.text || undefined) }}
                        >
                            No split segments configured.
                        </td>
                    </tr>
                )}
            </tbody>
        </table>
    );
}
