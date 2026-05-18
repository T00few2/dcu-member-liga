import { CartesianGrid, Cell, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';

import type { ResultEntry } from '@/types/live';
import type { SprintAnalysisRow, SprintXAxisMode, StatsMode } from '../_lib/stats-types';

type SprintAnalysisSectionProps = {
    sprintXAxis: SprintXAxisMode;
    setSprintXAxis: (mode: SprintXAxisMode) => void;
    sprintCategoryFilter: string;
    setSprintCategoryFilter: (category: string) => void;
    sprintFilterCategories: string[];
    configuredSprintsCount: number;
    sprintAnalysisRowsForDisplay: SprintAnalysisRow[];
    highlightedRiderId: string | null;
    setHighlightedRiderId: (zwiftId: string | null) => void;
    statsMode: StatsMode;
    userResult: ResultEntry | null;
    exportSprintCsv: () => void;
    formatTime: (ms: number) => string;
};

export function SprintAnalysisSection({
    sprintXAxis,
    setSprintXAxis,
    sprintCategoryFilter,
    setSprintCategoryFilter,
    sprintFilterCategories,
    configuredSprintsCount,
    sprintAnalysisRowsForDisplay,
    highlightedRiderId,
    setHighlightedRiderId,
    statsMode,
    userResult,
    exportSprintCsv,
    formatTime,
}: SprintAnalysisSectionProps) {
    const hasNoUserSprintData = Boolean(
        configuredSprintsCount > 0 &&
            userResult &&
            (!userResult.sprintData || Object.keys(userResult.sprintData).length === 0),
    );

    return (
        <section>
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold flex items-center gap-2">
                    <span>⚡ Sprintanalyse</span>
                </h2>

                <div className="bg-muted/30 p-1 rounded-lg flex text-xs font-medium">
                    <button
                        onClick={() => setSprintXAxis('rank')}
                        className={`px-3 py-1 rounded transition-colors ${sprintXAxis === 'rank' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                        Efter Rang
                    </button>
                    <button
                        onClick={() => setSprintXAxis('time')}
                        className={`px-3 py-1 rounded transition-colors ${sprintXAxis === 'time' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                        Efter Tid
                    </button>
                </div>
            </div>
            <div className="flex justify-between items-center gap-3 mb-4 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground uppercase tracking-wide">Filter kategori:</span>
                    <button
                        type="button"
                        onClick={() => setSprintCategoryFilter('all')}
                        className={`text-xs px-2 py-1 rounded transition-colors ${sprintCategoryFilter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted/30 hover:bg-muted/50'}`}
                    >
                        Alle
                    </button>
                    {sprintFilterCategories.map((category) => (
                        <button
                            key={`sprint-filter-${category}`}
                            type="button"
                            onClick={() => setSprintCategoryFilter(category)}
                            className={`text-xs px-2 py-1 rounded transition-colors ${sprintCategoryFilter === category ? 'bg-primary text-primary-foreground' : 'bg-muted/30 hover:bg-muted/50'}`}
                        >
                            {category}
                        </button>
                    ))}
                </div>
                <button
                    type="button"
                    onClick={exportSprintCsv}
                    className="text-xs px-3 py-1.5 rounded bg-muted/30 hover:bg-muted/50 transition-colors"
                >
                    Download CSV
                </button>
            </div>
            <div className="text-xs text-muted-foreground mb-2">
                Aktivt filter: {sprintCategoryFilter === 'all' ? 'Alle' : sprintCategoryFilter}
            </div>

            {configuredSprintsCount === 0 && (
                <div className="text-muted-foreground italic">
                    Ingen sprintsegmenter konfigureret for denne visning i dette løb. Tilføj segmenter i League Manager for at aktivere sprintanalyse.
                </div>
            )}
            {hasNoUserSprintData && (
                <div className="text-muted-foreground italic mb-4">Ingen sprintdata registreret for dette løb.</div>
            )}

            {configuredSprintsCount > 0 &&
                sprintAnalysisRowsForDisplay.map((row) => (
                    <div key={row.sprintKey} className="mb-8">
                        <h3 className="text-lg font-semibold mb-3">Sprint {row.sprintIndex}</h3>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">
                            <div className="bg-card border border-border rounded-lg p-4 shadow-sm h-full">
                                <div className="flex justify-between items-center mb-3">
                                    <h4 className="font-semibold text-lg">
                                        {row.sprint.name}{' '}
                                        <span className="text-sm font-normal text-muted-foreground">#{row.sprint.count}</span>
                                    </h4>
                                </div>

                                {row.myData ? (
                                    <div className="grid grid-cols-4 gap-4 text-center mb-4">
                                        <div className="bg-muted/30 p-2 rounded">
                                            <div className="text-xs text-muted-foreground">Rang</div>
                                            <div className="font-mono font-bold">{row.myData.rank}</div>
                                        </div>
                                        <div className="bg-muted/30 p-2 rounded">
                                            <div className="text-xs text-muted-foreground">Tid</div>
                                            <div className="font-mono font-bold">{formatTime(row.myData.time)}</div>
                                            {row.scatterData.length > 0 && (
                                                <div className="text-[11px] text-muted-foreground mt-1">
                                                    {(() => {
                                                        const bestTime = Math.min(...row.scatterData.map((entry) => Number(entry.time)));
                                                        const delta = Number(row.myData.time) / 1000 - bestTime;
                                                        return delta <= 0.001 ? 'Bedste tid i klubvisning' : `+${delta.toFixed(2)}s fra bedste`;
                                                    })()}
                                                </div>
                                            )}
                                        </div>
                                        <div className="bg-muted/30 p-2 rounded">
                                            <div className="text-xs text-muted-foreground">Gns. effekt</div>
                                            <div className="font-mono font-bold text-orange-500">{row.myData.avgPower}w</div>
                                            {row.scatterData.length > 0 && (
                                                <div className="text-[11px] text-muted-foreground mt-1">
                                                    {(() => {
                                                        const bestPower = Math.max(...row.scatterData.map((entry) => Number(entry.power)));
                                                        const delta = Number(row.myData.avgPower) - bestPower;
                                                        return delta >= -0.5 ? 'Bedste effekt i klubvisning' : `${delta.toFixed(0)}w fra bedste`;
                                                    })()}
                                                </div>
                                            )}
                                        </div>
                                        <div className="bg-muted/30 p-2 rounded">
                                            <div className="text-xs text-muted-foreground">Point</div>
                                            <div className="font-mono font-bold">{userResult?.sprintDetails?.[row.sprintKey] || 0}</div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-muted-foreground italic">
                                        Du deltog ikke i dette løb, så din personlige sprinttabel vises ikke.
                                    </div>
                                )}
                            </div>

                            <div className="bg-card border border-border rounded-lg p-4 shadow-sm h-[320px]">
                                {row.scatterData.length === 0 ? (
                                    <div className="h-full flex items-center justify-center text-muted-foreground italic">
                                        Ingen sammenligningsdata for denne sprint med nuvaerende filter. Proev en anden kategori eller vaelg &quot;Alle&quot;.
                                    </div>
                                ) : (
                                    <>
                                        <h4 className="text-sm font-semibold text-muted-foreground mb-2 text-center">
                                            {row.sprint.name} #{row.sprint.count} Sammenligning
                                        </h4>
                                        <ResponsiveContainer width="100%" height="100%">
                                            <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                                                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                                                <XAxis
                                                    type="number"
                                                    dataKey={sprintXAxis === 'rank' ? 'rank' : 'time'}
                                                    name={sprintXAxis === 'rank' ? 'Rang' : 'Tid'}
                                                    unit={sprintXAxis === 'rank' ? '' : 's'}
                                                    domain={['auto', 'auto']}
                                                    tick={{ fontSize: 10 }}
                                                    label={{ value: sprintXAxis === 'rank' ? 'Rang' : 'Tid (s)', position: 'insideBottom', offset: -5, fontSize: 10 }}
                                                />
                                                <YAxis
                                                    type="number"
                                                    dataKey="power"
                                                    name="Effekt"
                                                    unit="w"
                                                    tick={{ fontSize: 10 }}
                                                    label={{ value: 'Effekt (w)', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle' }, fontSize: 10 }}
                                                />
                                                <Tooltip
                                                    cursor={{ strokeDasharray: '3 3' }}
                                                    content={({ active, payload }) => {
                                                        if (!(active && payload && payload.length)) return null;
                                                        const data = payload[0]?.payload;
                                                        if (!data) return null;
                                                        return (
                                                            <div className="bg-background border border-border p-2 rounded shadow text-xs">
                                                                <p className="font-bold" style={{ color: data.color }}>{data.name}</p>
                                                                <p>Rang: {data.rank}</p>
                                                                <p>Tid: {data.time.toFixed(2)}s</p>
                                                                <p>Effekt: {data.power}w</p>
                                                            </div>
                                                        );
                                                    }}
                                                />
                                                <Scatter name="Riders" data={row.scatterData}>
                                                    {row.scatterData.map((entry, index) => {
                                                        const entryId = String(entry.id);
                                                        return (
                                                            <Cell
                                                                key={`cell-${row.sprintKey}-${index}`}
                                                                fill={entry.color}
                                                                fillOpacity={highlightedRiderId && highlightedRiderId !== entryId ? Math.max(0.15, Number(entry.opacity) * 0.35) : entry.opacity}
                                                                stroke={entry.isMe ? '#b91c1c' : '#4f46e5'}
                                                                strokeOpacity={entry.isMe ? 1 : 0.85}
                                                                strokeWidth={highlightedRiderId === entryId ? 3 : (entry.isMe ? 2 : 1.5)}
                                                                onMouseEnter={() => setHighlightedRiderId(entryId)}
                                                                onMouseLeave={() => setHighlightedRiderId(null)}
                                                            />
                                                        );
                                                    })}
                                                </Scatter>
                                                {statsMode === 'club' && (
                                                    <text x="95%" y={20} textAnchor="end" fontSize="10" fill="#666">
                                                        Farver = kategorier
                                                    </text>
                                                )}
                                            </ScatterChart>
                                        </ResponsiveContainer>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
        </section>
    );
}
