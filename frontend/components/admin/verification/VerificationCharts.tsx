'use client';

import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, ComposedChart, Brush,
} from 'recharts';
import ChartTooltip from './ChartTooltip';
import type { ZwiftPowerResult } from '@/hooks/useRiderVerification';

const CP_DURATIONS = [
    { key: 'w5', label: '5s' },
    { key: 'w15', label: '15s' },
    { key: 'w30', label: '30s' },
    { key: 'w60', label: '1m' },
    { key: 'w120', label: '2m' },
    { key: 'w300', label: '5m' },
    { key: 'w1200', label: '20m' },
];

function formatDateTick(dateStr: string) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length < 3) return dateStr;
    return `${parts[1]}-${parts[0].slice(2)}`;
}

function getAxisTicks(data: { date: string }[]) {
    if (!data?.length) return [];
    if (data.length <= 5) return data.map(d => d.date);
    const step = Math.floor(data.length / 4);
    const ticks: string[] = [];
    for (let i = 0; i < data.length; i += step) ticks.push(data[i].date);
    if (ticks[ticks.length - 1] !== data[data.length - 1].date) ticks.push(data[data.length - 1].date);
    return ticks;
}

interface VerificationChartsProps {
    zpData: ZwiftPowerResult[];
    powerTrendStat: string;
    onPowerTrendStatChange: (v: string) => void;
    curveTimeRange: number;
    onCurveTimeRangeChange: (v: number) => void;
    /** CP curve of the specific race being verified (from dual recording result). */
    selectedRaceCpCurve?: Record<string, number> | null;
    /** Short label shown beside the highlighted curve, e.g. "12 Apr · 247 W avg" */
    selectedRaceLabel?: string | null;
}

export default function VerificationCharts({
    zpData,
    powerTrendStat,
    onPowerTrendStatChange,
    curveTimeRange,
    onCurveTimeRangeChange,
    selectedRaceCpCurve,
    selectedRaceLabel,
}: VerificationChartsProps) {
    const toEpochSeconds = (value: number | string): number => {
        if (typeof value === 'number') return value;
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
    };

    // Weight & height data
    const weightHeightData = zpData.map(d => ({
        date: new Date(toEpochSeconds(d.date) * 1000).toISOString().split('T')[0],
        weight: d.weight > 0 ? d.weight : null,
        height: d.height > 0 ? d.height : null,
    })).filter(d => d.weight || d.height);

    // Power trend data
    const ninetyDaysAgo = Date.now() / 1000 - 90 * 24 * 60 * 60;
    const powerData = zpData.filter(d => toEpochSeconds(d.date) > ninetyDaysAgo).map(d => ({
        date: new Date(toEpochSeconds(d.date) * 1000).toISOString().split('T')[0],
        timestamp: toEpochSeconds(d.date),
        power: powerTrendStat === 'avg' ? d.avg_watts : (d.cp_curve?.[powerTrendStat] ?? 0),
        hr: d.avg_hr,
        title: d.event_title,
    }));

    // CP curve data
    const curveCutoff = curveTimeRange === 0 ? 0 : Date.now() / 1000 - curveTimeRange * 24 * 60 * 60;
    const curveRaces = zpData.filter(d => toEpochSeconds(d.date) > curveCutoff);
    const bestCurve: Record<string, number> = {};
    CP_DURATIONS.forEach(dur => {
        bestCurve[dur.key] = curveRaces.reduce((max, race) => Math.max(max, race.cp_curve?.[dur.key] ?? 0), 0);
    });

    const cpCurveData = CP_DURATIONS.map(dur => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const point: Record<string, any> = {
            name: dur.label,
            maxPower: bestCurve[dur.key],
            racePower: selectedRaceCpCurve?.[dur.key] ?? null,
        };
        curveRaces.forEach(race => {
            if (race.cp_curve) point[`race_${toEpochSeconds(race.date)}`] = race.cp_curve[dur.key] || null;
        });
        return point;
    });

    const weightHeightTicks = getAxisTicks(weightHeightData);
    const powerTicks = getAxisTicks(powerData);

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* CP Curve */}
            <div className="bg-card p-4 rounded-lg shadow border border-border lg:col-span-1 flex flex-col">
                <div className="flex justify-between items-start mb-2">
                    <h3 className="text-lg font-semibold text-card-foreground">
                        {curveTimeRange === 0 ? 'All Time' : `${curveTimeRange} Day`} Power Curve
                    </h3>
                    <select
                        className="text-xs bg-background border border-input rounded px-2 py-1"
                        value={curveTimeRange}
                        onChange={e => onCurveTimeRangeChange(Number(e.target.value))}
                    >
                        <option value={30}>30 Days</option>
                        <option value={90}>90 Days</option>
                        <option value={180}>180 Days</option>
                        <option value={360}>360 Days</option>
                        <option value={0}>All Time</option>
                    </select>
                </div>

                {/* Selected race stat strip */}
                {selectedRaceCpCurve && (
                    <div className="mb-3 p-2 bg-orange-50 border border-orange-200 rounded text-xs">
                        <span className="font-medium text-orange-700">
                            Selected race{selectedRaceLabel ? `: ${selectedRaceLabel}` : ''}
                        </span>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 font-mono text-orange-800">
                            {CP_DURATIONS.map(dur => {
                                const v = selectedRaceCpCurve[dur.key];
                                const best = bestCurve[dur.key];
                                const overBest = v && best && v > best;
                                return v ? (
                                    <span key={dur.key} className={overBest ? 'font-bold text-red-600' : ''}>
                                        {dur.label}: {Math.round(v)}W{overBest ? ' ▲' : ''}
                                    </span>
                                ) : null;
                            })}
                        </div>
                    </div>
                )}

                <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={cpCurveData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
                            <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} />
                            <YAxis
                                label={{ value: 'Watts', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fill: '#8884d8', fontSize: 12 } }}
                                tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                            />
                            <Tooltip content={<ChartTooltip />} />
                            <Legend
                                verticalAlign="top"
                                height={36}
                                content={() => (
                                    <div className="flex justify-center gap-4 text-sm text-muted-foreground">
                                        <div className="flex items-center gap-2">
                                            <span className="block w-3 h-[2px] bg-[#8884d8]"></span>
                                            <span>Best ({curveTimeRange === 0 ? 'All' : `${curveTimeRange}d`})</span>
                                        </div>
                                        {selectedRaceCpCurve && (
                                            <div className="flex items-center gap-2">
                                                <span className="block w-3 h-[2px] bg-[#ff7300]"></span>
                                                <span>This Race</span>
                                            </div>
                                        )}
                                    </div>
                                )}
                            />
                            {curveRaces.map(race => (
                                <Line key={String(race.date)} type="monotone" dataKey={`race_${toEpochSeconds(race.date)}`}
                                    stroke="#8884d8" strokeOpacity={0.15} strokeWidth={1} dot={false} isAnimationActive={false} />
                            ))}
                            <Line type="monotone" dataKey="maxPower" stroke="#8884d8"
                                name={`Best (${curveTimeRange === 0 ? 'All' : `${curveTimeRange}d`})`} unit="W" strokeWidth={2} dot={{ r: 3 }} />
                            {selectedRaceCpCurve && (
                                <Line type="monotone" dataKey="racePower" stroke="#ff7300"
                                    name="This Race" unit="W" strokeWidth={2.5} dot={{ r: 4 }} isAnimationActive={false} />
                            )}
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Physical Profile */}
            <div className="bg-card p-4 rounded-lg shadow border border-border lg:col-span-1">
                <h3 className="text-lg font-semibold mb-4 text-card-foreground">Physical Profile</h3>
                <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={weightHeightData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
                            <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                                ticks={weightHeightTicks} tickFormatter={formatDateTick} />
                            <YAxis yAxisId="left" orientation="left" domain={['dataMin - 5', 'dataMax + 5']}
                                label={{ value: 'Height (cm)', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fill: '#8884d8', fontSize: 12 } }}
                                tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} />
                            <YAxis yAxisId="right" orientation="right" domain={['dataMin - 2', 'dataMax + 2']}
                                label={{ value: 'Weight (kg)', angle: 90, position: 'insideRight', style: { textAnchor: 'middle', fill: '#82ca9d', fontSize: 12 } }}
                                tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} />
                            <Tooltip content={<ChartTooltip />} />
                            <Legend verticalAlign="top" height={36} />
                            <Line yAxisId="left" type="monotone" dataKey="height" stroke="#8884d8" name="Height" unit="cm" dot={false} strokeWidth={2} />
                            <Line yAxisId="right" type="stepAfter" dataKey="weight" stroke="#82ca9d" name="Weight" unit="kg" dot={false} strokeWidth={2} />
                            <Brush dataKey="date" height={30} stroke="#8884d8" tickFormatter={formatDateTick} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Power Trend */}
            <div className="bg-card p-4 rounded-lg shadow border border-border lg:col-span-1 flex flex-col">
                <div className="flex justify-between items-start mb-4">
                    <h3 className="text-lg font-semibold text-card-foreground">Race Power Trend</h3>
                    <select
                        className="text-xs bg-background border border-input rounded px-2 py-1"
                        value={powerTrendStat}
                        onChange={e => onPowerTrendStatChange(e.target.value)}
                    >
                        <option value="avg">Avg Power</option>
                        <option value="w5">5s Power</option>
                        <option value="w15">15s Power</option>
                        <option value="w30">30s Power</option>
                        <option value="w60">1m Power</option>
                        <option value="w300">5m Power</option>
                        <option value="w1200">20m Power</option>
                    </select>
                </div>
                <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={powerData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
                            <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                                ticks={powerTicks} tickFormatter={formatDateTick} />
                            <YAxis label={{ value: 'Watts', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fill: '#ff7300', fontSize: 12 } }}
                                tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} />
                            <Tooltip content={<ChartTooltip />} />
                            <Legend verticalAlign="top" height={36} />
                            <Line type="monotone" dataKey="power" stroke="#ff7300"
                                name={powerTrendStat === 'avg' ? 'Avg Power' : `${powerTrendStat} Power`} unit="W"
                                strokeWidth={2} activeDot={{ r: 8 }} dot={false} />
                            <Line type="monotone" dataKey="hr" stroke="#ff0000" name="Avg HR" unit="bpm"
                                strokeWidth={1} strokeDasharray="5 5" opacity={0.6} dot={false} />
                            <Brush dataKey="date" height={30} stroke="#ff7300" tickFormatter={formatDateTick} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
}
