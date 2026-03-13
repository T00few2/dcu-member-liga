'use client';

import { useEffect, useState } from 'react';
import {
    Area,
    AreaChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';

interface Props {
    worldName: string;
    routeName: string;
}

interface DataPoint {
    distance: number; // km
    altitude: number; // m
}

const TARGET_POINTS = 400;

export default function RouteElevationChart({ worldName, routeName }: Props) {
    const [data, setData] = useState<DataPoint[] | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const params = new URLSearchParams({ world: worldName, route: routeName });
        fetch(`/api/route-elevation?${params}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((json: { distance: number[]; altitude: number[] } | null) => {
                if (json?.distance?.length && json?.altitude?.length) {
                    const n = Math.max(1, Math.floor(json.distance.length / TARGET_POINTS));
                    setData(
                        json.distance
                            .filter((_, i) => i % n === 0)
                            .map((d, i) => ({
                                distance: d / 1_000,
                                altitude: json.altitude[i * n],
                            }))
                    );
                }
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [worldName, routeName]);

    if (loading) {
        return (
            <div className="h-20 flex items-center justify-center text-muted-foreground text-xs">
                Henter ruteprofil…
            </div>
        );
    }

    if (!data) return null;

    return (
        <div style={{ width: '100%', height: 80 }}>
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data} margin={{ top: 8, bottom: 4 }} baseValue="dataMin">
                    <defs>
                        <linearGradient id="elevGrad" x1="0" y1="0" x2="0" y2="100%">
                            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.6} />
                            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} strokeOpacity={0.15} />
                    <XAxis dataKey="distance" type="number" hide domain={[0, 'dataMax']} />
                    <YAxis type="number" hide domain={['dataMin', 'auto']} />
                    <Tooltip
                        formatter={(val: number) => [`${Math.round(val)} m`, 'Højde']}
                        labelFormatter={(val: number) => `${Number(val).toFixed(1)} km`}
                        contentStyle={{ fontSize: 11 }}
                        isAnimationActive={false}
                    />
                    <Area
                        type="monotone"
                        dataKey="altitude"
                        stroke="hsl(var(--primary))"
                        strokeWidth={1.5}
                        fill="url(#elevGrad)"
                        dot={false}
                        isAnimationActive={false}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}
