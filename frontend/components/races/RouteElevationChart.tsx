'use client';

import { useEffect, useState } from 'react';
import {
    Area,
    AreaChart,
    CartesianGrid,
    ReferenceArea,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';

interface RouteSegment {
    from: number;
    to: number;
    type: 'sprint' | 'climb';
}

interface Props {
    worldName: string;
    routeName: string;
}

interface DataPoint {
    distance: number; // km
    altitude: number; // m
    gradient: number; // %
}

const TARGET_POINTS = 400;
const STRIP_STOPS = 80;

const SEGMENT_COLORS: Record<RouteSegment['type'], string> = {
    sprint: '#56A845',
    climb:  '#ed2324',
};

// Standard cycling gradient colour scale
function gradientColor(pct: number): string {
    if (pct > 8)  return '#cc0000';
    if (pct > 5)  return '#ff4500';
    if (pct > 3)  return '#ff8c00';
    if (pct > 1)  return '#ffd700';
    if (pct > -1) return '#22aa55';
    if (pct > -3) return '#4da6ff';
    return '#0066cc';
}

function GradientStrip({ data }: { data: DataPoint[] }) {
    const maxDist = data[data.length - 1].distance;
    const n = Math.max(1, Math.floor(data.length / STRIP_STOPS));
    const stops = data
        .filter((_, i) => i % n === 0)
        .map((p) => `${gradientColor(p.gradient)} ${((p.distance / maxDist) * 100).toFixed(1)}%`)
        .join(', ');

    return (
        <div style={{ height: 8, borderRadius: 3, background: `linear-gradient(to right, ${stops})` }} />
    );
}

function ElevationTooltip({ active, payload, label }: any) {
    if (!active || !payload?.length) return null;
    const pt: DataPoint = payload[0].payload;
    const sign = pt.gradient > 0 ? '+' : '';
    return (
        <div className="rounded border bg-popover px-2 py-1 shadow text-xs space-y-0.5">
            <div className="font-medium">{Number(label).toFixed(1)} km</div>
            <div>{Math.round(pt.altitude)} m</div>
            <div style={{ color: gradientColor(pt.gradient) }}>
                {sign}{pt.gradient.toFixed(1)}%
            </div>
        </div>
    );
}

export default function RouteElevationChart({ worldName, routeName }: Props) {
    const [data, setData] = useState<DataPoint[] | null>(null);
    const [routeSegments, setRouteSegments] = useState<RouteSegment[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const params = new URLSearchParams({ world: worldName, route: routeName });
        fetch(`/api/route-elevation?${params}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((json: { distance: number[]; altitude: number[]; segments?: RouteSegment[] } | null) => {
                if (json?.distance?.length && json?.altitude?.length) {
                    const n = Math.max(1, Math.floor(json.distance.length / TARGET_POINTS));
                    const raw = json.distance
                        .filter((_, i) => i % n === 0)
                        .map((d, i) => ({
                            distance: d / 1_000,
                            altitude: json.altitude[i * n],
                        }));

                    // gradient % = (Δalt_m / Δdist_m) * 100
                    const enriched: DataPoint[] = raw.map((pt, i) => ({
                        ...pt,
                        gradient:
                            i === 0
                                ? 0
                                : Math.round(
                                      ((pt.altitude - raw[i - 1].altitude) /
                                          ((pt.distance - raw[i - 1].distance) * 1_000)) *
                                          1_000
                                  ) / 10,
                    }));
                    setData(enriched);
                    setRouteSegments(json.segments ?? []);
                }
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [worldName, routeName]);

    if (loading) {
        return (
            <div className="h-28 flex items-center justify-center text-muted-foreground text-xs">
                Henter ruteprofil…
            </div>
        );
    }

    if (!data) return null;

    return (
        <div>
            <div style={{ width: '100%', height: 130 }}>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data} margin={{ top: 8, bottom: 4 }} baseValue="dataMin">
                        <defs>
                            <linearGradient id="elevGrad" x1="0" y1="0" x2="0" y2="100%">
                                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.55} />
                                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} strokeOpacity={0.15} />
                        <XAxis dataKey="distance" type="number" hide domain={[0, 'dataMax']} />
                        <YAxis type="number" hide domain={['dataMin', 'auto']} />
                        <Tooltip content={<ElevationTooltip />} isAnimationActive={false} />

                        {/* Sprint and KOM overlays */}
                        {routeSegments.map((seg, i) => (
                            <ReferenceArea
                                key={i}
                                x1={seg.from}
                                x2={seg.to}
                                fill={SEGMENT_COLORS[seg.type]}
                                fillOpacity={0.25}
                                stroke={SEGMENT_COLORS[seg.type]}
                                strokeOpacity={0.6}
                                strokeWidth={1}
                            />
                        ))}

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
            <GradientStrip data={data} />
        </div>
    );
}
