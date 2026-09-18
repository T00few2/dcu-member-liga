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

import { formatConvertedPower, groupPowerLegendEntries, powerAxisLabel, toDisplayPower } from '../_lib/stats-helpers';
import type { PowerLineStyle, PowerUnit, RiderWithPower, StatsMode } from '../_lib/stats-types';
import { PowerUnitToggle } from './PowerUnitToggle';

type PowerLegendEntry = {
    rider: RiderWithPower;
    style: PowerLineStyle;
    isHidden: boolean;
};

type PowerCurveSectionProps = {
    statsMode: StatsMode;
    userCategory: string | null;
    powerUnit: PowerUnit;
    setPowerUnit: (unit: PowerUnit) => void;
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
    powerUnit,
    setPowerUnit,
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
    const legendGroups = groupPowerLegendEntries(powerLegendEntries, statsMode === 'club');
    const yAxisLabel = powerAxisLabel(powerUnit);

    return (
        <section>
            <div className="flex justify-between items-center mb-4 gap-3 flex-wrap">
                <h2 className="text-2xl font-bold flex items-center gap-2">
                    <span>💪 Sammenligning af effektkurve</span>
                </h2>
                <div className="flex items-center gap-2">
                    <PowerUnitToggle value={powerUnit} onChange={setPowerUnit} />
                    <button
                        type="button"
                        onClick={exportPowerCurvePng}
                        className="text-xs px-3 py-1.5 rounded bg-muted/30 hover:bg-muted/50 transition-colors"
                    >
                        Download PNG
                    </button>
                </div>
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
                <div className="max-h-44 overflow-y-auto mb-4 rounded-md border border-border/70 bg-muted/10 p-2">
                    {legendGroups.map((group) => (
                        <div key={group.key} className="mb-2 last:mb-0">
                            {group.label && (
                                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-1 mb-1">
                                    {group.label}
                                </div>
                            )}
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-1 gap-y-0.5">
                                {group.entries.map(({ rider, style, isHidden }) => {
                                    const riderId = String(rider.zwiftId);
                                    const missingWkg = powerUnit === 'wkg' && !rider.weightKg;
                                    return (
                                        <button
                                            key={`legend-toggle-${rider.zwiftId}`}
                                            type="button"
                                            onClick={() => toggleRiderVisibility(riderId)}
                                            onMouseEnter={() => setHighlightedRiderId(riderId)}
                                            onMouseLeave={() => setHighlightedRiderId(null)}
                                            className={`flex min-w-0 overflow-hidden items-center gap-1 px-1.5 py-0.5 rounded text-xs text-left transition ${isHidden || missingWkg ? 'opacity-40' : 'opacity-100'}`}
                                            title={
                                                missingWkg
                                                    ? 'Mangler vægt, så W/kg kan ikke vises'
                                                    : isHidden
                                                        ? 'Klik for at vise rytter'
                                                        : 'Klik for at skjule rytter'
                                            }
                                        >
                                            <span className="shrink-0" style={{ color: style.strokeColor }}>●</span>
                                            <span className={`truncate whitespace-nowrap ${isHidden ? 'line-through' : ''} ${style.isMe || highlightedRiderId === riderId ? 'font-semibold' : ''}`}>
                                                {style.name}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
                <div className="relative h-[400px] w-full" ref={powerCurveChartRef}>
                    {powerUnit === 'wkg' && visibleDisplayRidersWithPower.every((rider) => !rider.weightKg) ? (
                        <div className="h-full flex items-center justify-center px-6 text-center text-sm text-muted-foreground">
                            W/kg kan ikke vises uden rytternes vægt. Log ind for at hente vægtdata, eller skift tilbage til W.
                        </div>
                    ) : (
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
                                label={{ value: yAxisLabel, angle: -90, position: 'insideLeft' }}
                                tick={{ fontSize: 12 }}
                                tickFormatter={(value: number) => (
                                    powerUnit === 'wkg' ? Number(value).toFixed(1) : String(Math.round(Number(value)))
                                )}
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
                                                        {row.name}: {formatConvertedPower(row.value, powerUnit)}
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
                                                {preferredPayload.name}: {formatConvertedPower(preferredPayload.value, powerUnit)}
                                            </p>
                                        </div>
                                    );
                                }}
                            />

                            {visibleDisplayRidersWithPower.map((rider) => {
                                const { isMe, isTeammate, strokeColor, strokeWidth, opacity, name, tooltipName } = getLineStyle(rider);
                                const riderId = String(rider.zwiftId);
                                const data = [
                                    { name: '15s', value: toDisplayPower(rider.resolvedCriticalPower.criticalP15Seconds, rider.weightKg, powerUnit) },
                                    { name: '1m', value: toDisplayPower(rider.resolvedCriticalPower.criticalP1Minute, rider.weightKg, powerUnit) },
                                    { name: '5m', value: toDisplayPower(rider.resolvedCriticalPower.criticalP5Minutes, rider.weightKg, powerUnit) },
                                    { name: '20m', value: toDisplayPower(rider.resolvedCriticalPower.criticalP20Minutes, rider.weightKg, powerUnit) },
                                ];
                                if (data.every((point) => point.value === null)) return null;

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
                                        name={tooltipName || name}
                                        legendType="none"
                                        isAnimationActive={false}
                                        connectNulls={false}
                                        onMouseEnter={() => setHighlightedRiderId(riderId)}
                                        onMouseLeave={() => setHighlightedRiderId(null)}
                                    />
                                );
                            })}
                        </LineChart>
                    </ResponsiveContainer>
                    )}
                </div>
                <p className="text-sm text-muted-foreground text-center mt-4">
                    {statsMode === 'club'
                        ? `Sammenligner kritisk effekt (${yAxisLabel}) for ryttere fra din klub i dette løb.`
                        : `Sammenligner din kritiske effekt (15s, 1m, 5m, 20m) i ${yAxisLabel} mod alle andre ryttere i kategori ${userCategory}.`}
                </p>
            </div>
        </section>
    );
}
