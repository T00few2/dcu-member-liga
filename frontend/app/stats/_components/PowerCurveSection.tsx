import type { RefObject } from 'react';
import {
    CartesianGrid,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';

import type { PowerLineStyle, RiderWithPower, StatsMode } from '../_lib/stats-types';

type PowerLegendEntry = {
    rider: RiderWithPower;
    style: PowerLineStyle;
    isHidden: boolean;
};

type PowerCurveSectionProps = {
    statsMode: StatsMode;
    userCategory: string | null;
    powerLegendEntries: PowerLegendEntry[];
    visibleDisplayRidersWithPower: RiderWithPower[];
    highlightedRiderId: string | null;
    powerCurveChartRef: RefObject<HTMLDivElement | null>;
    getLineStyle: (rider: RiderWithPower) => PowerLineStyle;
    toggleRiderVisibility: (zwiftId: string) => void;
    setHighlightedRiderId: (zwiftId: string | null) => void;
    showAllRiders: () => void;
    hideAllRiders: () => void;
    showOnlyMe: () => void;
    exportPowerCurvePng: () => void | Promise<void>;
};

export function PowerCurveSection({
    statsMode,
    userCategory,
    powerLegendEntries,
    visibleDisplayRidersWithPower,
    highlightedRiderId,
    powerCurveChartRef,
    getLineStyle,
    toggleRiderVisibility,
    setHighlightedRiderId,
    showAllRiders,
    hideAllRiders,
    showOnlyMe,
    exportPowerCurvePng,
}: PowerCurveSectionProps) {
    return (
        <section>
            <div className="flex justify-between items-center mb-4 gap-3 flex-wrap">
                <h2 className="text-2xl font-bold flex items-center gap-2">
                    <span>💪 Sammenligning af effektkurve</span>
                </h2>
                <button
                    type="button"
                    onClick={exportPowerCurvePng}
                    className="text-xs px-3 py-1.5 rounded bg-muted/30 hover:bg-muted/50 transition-colors"
                >
                    Download PNG
                </button>
            </div>

            <div className="bg-card border border-border p-6 rounded-lg shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div className="text-xs text-muted-foreground">Klik på navne for at skjule/vise ryttere</div>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={showAllRiders}
                            className="text-xs px-2 py-1 rounded bg-muted/30 hover:bg-muted/50 transition-colors"
                        >
                            Vis alle
                        </button>
                        <button
                            type="button"
                            onClick={hideAllRiders}
                            className="text-xs px-2 py-1 rounded bg-muted/30 hover:bg-muted/50 transition-colors"
                        >
                            Skjul alle
                        </button>
                        <button
                            type="button"
                            onClick={showOnlyMe}
                            className="text-xs px-2 py-1 rounded bg-muted/30 hover:bg-muted/50 transition-colors"
                        >
                            Kun mig
                        </button>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2 mb-4">
                    {powerLegendEntries.map(({ rider, style, isHidden }) => (
                        <button
                            key={`legend-toggle-${rider.zwiftId}`}
                            type="button"
                            onClick={() => toggleRiderVisibility(String(rider.zwiftId))}
                            onMouseEnter={() => setHighlightedRiderId(String(rider.zwiftId))}
                            onMouseLeave={() => setHighlightedRiderId(null)}
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs transition ${isHidden ? 'opacity-40' : 'opacity-100'}`}
                            title={isHidden ? 'Klik for at vise rytter' : 'Klik for at skjule rytter'}
                        >
                            <span style={{ color: style.strokeColor }}>●</span>
                            <span className={`${isHidden ? 'line-through' : ''} ${highlightedRiderId === String(rider.zwiftId) ? 'font-semibold' : ''}`}>
                                {style.name}
                            </span>
                        </button>
                    ))}
                </div>
                <div className="h-[400px] w-full" ref={powerCurveChartRef}>
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                            <XAxis
                                dataKey="name"
                                type="category"
                                allowDuplicatedCategory={false}
                                tick={{ fontSize: 12 }}
                            />
                            <YAxis
                                label={{ value: 'Watts', angle: -90, position: 'insideLeft' }}
                                tick={{ fontSize: 12 }}
                            />
                            <Tooltip
                                content={({ active, payload, label }) => {
                                    if (!(active && payload && payload.length)) return null;

                                    if (statsMode === 'club') {
                                        const rows = [...payload]
                                            .filter((entry) => entry && entry.name && entry.value !== undefined && entry.value !== null)
                                            .sort((a, b) => {
                                                const aIsMe = a.name === 'Mig' ? 1 : 0;
                                                const bIsMe = b.name === 'Mig' ? 1 : 0;
                                                if (aIsMe !== bIsMe) return bIsMe - aIsMe;
                                                const aVal = Number(a.value ?? 0);
                                                const bVal = Number(b.value ?? 0);
                                                return bVal - aVal;
                                            })
                                            .slice(0, 8);
                                        if (rows.length === 0) return null;
                                        return (
                                            <div className="bg-background border border-border p-2 rounded shadow text-sm">
                                                <p className="font-bold mb-1">{label}</p>
                                                {rows.map((row) => (
                                                    <p key={`${label}-${row.name}`} style={{ color: row.color }}>
                                                        {row.name}: {row.value}w
                                                    </p>
                                                ))}
                                            </div>
                                        );
                                    }

                                    const myPayload = payload.find((p) => p.name === 'Mig');
                                    const preferredPayload = myPayload || payload[0];
                                    if (!preferredPayload) return null;

                                    return (
                                        <div className="bg-background border border-border p-2 rounded shadow text-sm">
                                            <p className="font-bold mb-1">{label}</p>
                                            <p style={{ color: preferredPayload.color }}>
                                                {preferredPayload.name}: {preferredPayload.value}w
                                            </p>
                                        </div>
                                    );
                                }}
                            />

                            {visibleDisplayRidersWithPower.map((rider) => {
                                const { isMe, isTeammate, strokeColor, strokeWidth, opacity, name } = getLineStyle(rider);
                                const riderId = String(rider.zwiftId);
                                const data = [
                                    { name: '15s', value: rider.resolvedCriticalPower.criticalP15Seconds },
                                    { name: '1m', value: rider.resolvedCriticalPower.criticalP1Minute },
                                    { name: '5m', value: rider.resolvedCriticalPower.criticalP5Minutes },
                                    { name: '20m', value: rider.resolvedCriticalPower.criticalP20Minutes },
                                ];

                                return (
                                    <Line
                                        key={rider.zwiftId}
                                        data={data}
                                        type="monotone"
                                        dataKey="value"
                                        stroke={strokeColor}
                                        strokeWidth={strokeWidth}
                                        strokeOpacity={highlightedRiderId && highlightedRiderId !== riderId ? Math.max(0.1, opacity * 0.25) : opacity}
                                        dot={isMe || (statsMode === 'club' && isTeammate)}
                                        activeDot={{ r: highlightedRiderId === riderId ? 8 : 6 }}
                                        name={name}
                                        legendType="none"
                                        isAnimationActive={false}
                                        onMouseEnter={() => setHighlightedRiderId(riderId)}
                                        onMouseLeave={() => setHighlightedRiderId(null)}
                                    />
                                );
                            })}
                        </LineChart>
                    </ResponsiveContainer>
                </div>
                <p className="text-sm text-muted-foreground text-center mt-4">
                    {statsMode === 'club'
                        ? 'Sammenligner kritisk effekt for ryttere fra din klub i dette løb.'
                        : `Sammenligner din kritiske effekt (15s, 1m, 5m, 20m) mod alle andre ryttere i kategori ${userCategory}.`}
                </p>
            </div>
        </section>
    );
}
