'use client';

import { ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Brush } from 'recharts';
import ChartTooltip from './ChartTooltip';
import type { StravaActivity, StravaStream } from '@/hooks/useRiderVerification';

interface StravaActivityDetailProps {
    activity: StravaActivity;
    streams: StravaStream[];
    loading: boolean;
    onClose: () => void;
}

export default function StravaActivityDetail({ activity, streams, loading, onClose }: StravaActivityDetailProps) {
    return (
        <div className="bg-card p-4 rounded-lg shadow border border-border mt-6 relative">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-card-foreground">
                    Strava Analysis: {activity.name}
                </h3>
                <button
                    onClick={onClose}
                    className="p-1 hover:bg-muted rounded-full transition"
                    title="Close Analysis"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>

            {loading ? (
                <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                    Loading stream data...
                </div>
            ) : streams.length > 0 ? (
                <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={streams}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
                            <XAxis dataKey="timeLabel" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} minTickGap={50} />
                            <YAxis yAxisId="left"
                                label={{ value: 'Power (W)', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fill: '#FC4C02', fontSize: 12 } }}
                                tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} />
                            <YAxis yAxisId="right" orientation="right"
                                label={{ value: 'Cadence (rpm)', angle: 90, position: 'insideRight', style: { textAnchor: 'middle', fill: '#82ca9d', fontSize: 12 } }}
                                tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} />
                            <YAxis yAxisId="elevation" orientation="right" hide domain={['dataMin', 'dataMax']} />
                            <Tooltip content={<ChartTooltip />} />
                            <Legend verticalAlign="top" height={36} />
                            <Area yAxisId="elevation" type="monotone" dataKey="altitude"
                                fill="#888888" stroke="#888888" fillOpacity={0.15} strokeOpacity={0.3} name="Elevation" unit="m" />
                            <Line yAxisId="left" type="monotone" dataKey="watts" stroke="#FC4C02"
                                name="Power" unit="W" dot={false} strokeWidth={1.5} />
                            <Line yAxisId="right" type="monotone" dataKey="cadence" stroke="#82ca9d"
                                name="Cadence" unit="rpm" dot={false} strokeWidth={1.5} opacity={0.7} />
                            <Brush dataKey="timeLabel" height={30} stroke="#FC4C02" />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            ) : (
                <div className="h-[300px] flex items-center justify-center text-muted-foreground italic">
                    No stream data available for this activity.
                </div>
            )}
        </div>
    );
}
