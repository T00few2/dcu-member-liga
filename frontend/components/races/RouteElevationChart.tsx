'use client';

import { useMemo, type ReactNode } from 'react';
import {
    Area,
    AreaChart,
    CartesianGrid,
    Customized,
    ReferenceArea,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
    usePlotArea,
    useXAxisDomain,
    useYAxisDomain,
} from 'recharts';
import type { Sprint } from '@/types/live';
import { useRaceSegmentsQuery, useRouteElevationQuery } from '@/hooks/queries';
import { mergeElevationProfileWithLapBanners } from '@/lib/routeProfileSegments';

interface RouteSegment {
    from: number;
    to: number;
    type: 'sprint' | 'climb' | 'segment';
    name?: string;
    direction?: 'forward' | 'reverse';
}

interface ProfileSegment {
    name: string;
    type: 'sprint' | 'climb' | 'segment';
    fromKm: number;
    toKm: number;
    direction?: 'forward' | 'reverse';
}

/** Minimum band width (km) before a segment is treated as a point banner. */
const POINT_BANNER_EPSILON_KM = 0.05;

export interface RouteElevationOverlayContext {
    lapLengthKm: number;
    totalDistanceKm: number;
    leadInKm: number;
    laps: number;
    xScale: (km: number) => number;
    yScale: (altitudeM: number) => number;
    altitudeAt: (km: number) => number;
    dataPoints: DataPoint[];
    chartHeight: number;
    plotTop: number;
    plotBottom: number;
    plotLeft: number;
    plotRight: number;
}

interface Props {
    worldName: string;
    routeName: string;
    laps?: number;
    /** Route id used to load event segments and synthesize missing lap banners. */
    routeId?: string | number;
    pointSegments?: Sprint[];
    /** Merged into route profile overlays after lap-banner synthesis. */
    extraProfileSegments?: ProfileSegment[];
    overlay?: (ctx: RouteElevationOverlayContext) => ReactNode;
    height?: number;
}

interface DataPoint {
    distance: number; // km
    altitude: number; // m
    gradient: number; // %
}

const TARGET_POINTS = 400;
const SEGMENT_COLORS: Record<RouteSegment['type'], string> = {
    sprint: '#56A845',
    climb:  '#ed2324',
    segment: '#6b7280',
};

function getNiceStep(rawStep: number): number {
    if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
    const exponent = Math.floor(Math.log10(rawStep));
    const fraction = rawStep / 10 ** exponent;
    let niceFraction: number;

    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;

    return niceFraction * 10 ** exponent;
}

function gradientColor(pct: number): string {
    if (pct > 8)  return '#cc0000';
    if (pct > 5)  return '#ff4500';
    if (pct > 3)  return '#ff8c00';
    if (pct > 1)  return '#ffd700';
    if (pct > -1) return '#22aa55';
    if (pct > -3) return '#4da6ff';
    return '#0066cc';
}

function normalizeSegmentType(type: unknown): RouteSegment['type'] {
    return type === 'sprint' || type === 'climb' || type === 'segment' ? type : 'segment';
}

function getSegmentName(name: unknown): string {
    if (typeof name !== 'string') return 'Segment';
    const trimmed = name.trim();
    return trimmed.length > 0 ? trimmed : 'Segment';
}

function normalizeNameForMatch(name?: string): string {
    return getSegmentName(name)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/['’`]/g, ' ')
        .replace(/\s+\(.*\)\s*$/g, '')
        .replace(/\s+(reverse|rev\.?)$/g, '')
        .replace(/[-_]+/g, ' ')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeDirectionForMatch(direction?: string, name?: string): 'forward' | 'reverse' {
    const d = (direction || '').trim().toLowerCase();
    if (d === 'reverse' || d === 'rev' || d === 'r') return 'reverse';
    if (d === 'forward' || d === 'f') return 'forward';
    const n = getSegmentName(name).toLowerCase();
    if (n.includes('reverse') || n.includes(' rev')) return 'reverse';
    return 'forward';
}

function normalizeDirection(direction?: string): 'forward' | 'reverse' {
    return direction === 'reverse' ? 'reverse' : 'forward';
}

function compactSegmentLabel(name?: string, direction?: 'forward' | 'reverse'): string {
    const compact = getSegmentName(name)
        .replace(/\s+(reverse|rev\.?)$/i, ' Rev.')
        .replace(/\s+mountainside/i, ' Mtn.')
        .trim();
    const MAX_LEN = 20;
    return compact.length > MAX_LEN ? `${compact.slice(0, MAX_LEN - 1)}…` : compact;
}

function renderCenteredSegmentLabel(props: any, value: string, color: string, showPointIcon = false) {
    const { viewBox } = props || {};
    if (!viewBox) return null;
    const cx = viewBox.x + viewBox.width / 2;
    const cy = viewBox.y + viewBox.height / 2;

    return (
        <g pointerEvents="none">
            {showPointIcon && (
                <text
                    x={cx}
                    y={viewBox.y + 2}
                    fill="#d97706"
                    fontSize={10}
                    fontWeight={700}
                    textAnchor="middle"
                    dominantBaseline="hanging"
                >
                    ★
                </text>
            )}
            <text
                x={cx}
                y={cy}
                fill={color}
                fontSize={9}
                fontWeight={600}
                textAnchor="middle"
                dominantBaseline="central"
                transform={`rotate(-90, ${cx}, ${cy})`}
            >
                {value}
            </text>
        </g>
    );
}

function segmentContainsKm(seg: RouteSegment, dist: number): boolean {
    const lo = Math.min(seg.from, seg.to);
    const hi = Math.max(seg.from, seg.to);
    if (hi - lo <= POINT_BANNER_EPSILON_KM) {
        return Math.abs(dist - lo) <= POINT_BANNER_EPSILON_KM;
    }
    return dist >= lo && dist <= hi;
}

function ElevationTooltip({
    active, payload, label, routeSegments, pointSegmentOccurrenceKeys, routeOccurrenceKeys,
}: any) {
    if (!active || !payload?.length) return null;
    const pt: DataPoint = payload[0].payload;
    const dist = Number(label);
    const segIndex: number = routeSegments?.findIndex((s: RouteSegment) => segmentContainsKm(s, dist));
    const seg: RouteSegment | undefined = segIndex >= 0 ? routeSegments?.[segIndex] : undefined;
    const occKey = segIndex >= 0 ? routeOccurrenceKeys?.[segIndex] : '';
    const isPointSegment = !!seg && pointSegmentOccurrenceKeys?.has(occKey);
    const sign = pt.gradient > 0 ? '+' : '';
    return (
        <div className="rounded border bg-popover px-2 py-1 shadow text-xs space-y-0.5">
            <div className="font-medium">{dist.toFixed(1)} km</div>
            {seg && (
                <div style={{ color: SEGMENT_COLORS[normalizeSegmentType(seg.type)], fontWeight: 600 }}>
                    {compactSegmentLabel(seg.name, seg.direction)}
                </div>
            )}
            {isPointSegment && (
                <div style={{ color: '#d97706', fontWeight: 700 }}>Points segment</div>
            )}
            <div>{Math.round(pt.altitude)} m</div>
            <div style={{ color: gradientColor(pt.gradient) }}>
                {sign}{pt.gradient.toFixed(1)}%
            </div>
        </div>
    );
}

const CHART_HEIGHT = 160;

function buildAltitudeAt(data: DataPoint[]): (km: number) => number {
    return (km: number) => {
        if (!data.length) return 0;
        if (km <= data[0].distance) return data[0].altitude;
        if (km >= data[data.length - 1].distance) return data[data.length - 1].altitude;
        let lo = 0;
        let hi = data.length - 1;
        while (lo < hi - 1) {
            const mid = Math.floor((lo + hi) / 2);
            if (data[mid].distance <= km) lo = mid;
            else hi = mid;
        }
        const a = data[lo];
        const b = data[hi];
        const span = b.distance - a.distance;
        if (span <= 0) return a.altitude;
        const t = (km - a.distance) / span;
        return a.altitude + t * (b.altitude - a.altitude);
    };
}

function isNumericDomain(d: unknown): d is readonly [number, number] {
    return Array.isArray(d) && d.length === 2 && typeof d[0] === 'number' && typeof d[1] === 'number';
}

/** Min lap band width (px) before showing L1/L2 labels. */
const LAP_LABEL_MIN_WIDTH_PX = 40;

function LapDivisionLayer({
    data,
    laps,
    layer,
}: {
    data: DataPoint[];
    laps: number;
    layer: 'bands' | 'guides';
}): ReactNode {
    const plotArea = usePlotArea();
    const xDomain = useXAxisDomain(0);

    if (!plotArea || !isNumericDomain(xDomain) || laps <= 1 || !data.length) {
        return null;
    }

    const [xMin, xMax] = xDomain;
    const xSpan = xMax - xMin || 1;
    const totalDistanceKm = data[data.length - 1]?.distance ?? 0;
    if (!(totalDistanceKm > 0)) return null;

    const lapLengthKm = totalDistanceKm / laps;
    const xScale = (km: number) => plotArea.x + ((km - xMin) / xSpan) * plotArea.width;
    const lapWidthPx = (lapLengthKm / xSpan) * plotArea.width;
    const showLabels = layer === 'guides' && lapWidthPx >= LAP_LABEL_MIN_WIDTH_PX;

    const nodes: ReactNode[] = [];

    if (layer === 'bands') {
        for (let lap = 0; lap < laps; lap++) {
            if (lap % 2 === 0) continue; // tint L2, L4, …
            const x1 = xScale(lap * lapLengthKm);
            const x2 = xScale(Math.min((lap + 1) * lapLengthKm, totalDistanceKm));
            const width = Math.max(0, x2 - x1);
            if (width <= 0) continue;
            nodes.push(
                <rect
                    key={`lap-band-${lap}`}
                    x={x1}
                    y={plotArea.y}
                    width={width}
                    height={plotArea.height}
                    fill="hsl(var(--muted-foreground))"
                    fillOpacity={0.055}
                    pointerEvents="none"
                />,
            );
        }
        return <g className="lap-bands">{nodes}</g>;
    }

    for (let lap = 1; lap < laps; lap++) {
        const x = xScale(lap * lapLengthKm);
        nodes.push(
            <line
                key={`lap-line-${lap}`}
                x1={x}
                x2={x}
                y1={plotArea.y}
                y2={plotArea.y + plotArea.height}
                stroke="hsl(var(--muted-foreground))"
                strokeOpacity={0.28}
                strokeWidth={1}
                pointerEvents="none"
            />,
        );
    }

    if (showLabels) {
        for (let lap = 0; lap < laps; lap++) {
            const x1 = xScale(lap * lapLengthKm);
            const x2 = xScale(Math.min((lap + 1) * lapLengthKm, totalDistanceKm));
            nodes.push(
                <text
                    key={`lap-label-${lap}`}
                    x={(x1 + x2) / 2}
                    y={plotArea.y + 11}
                    textAnchor="middle"
                    dominantBaseline="hanging"
                    fontSize={9}
                    fontWeight={600}
                    fill="hsl(var(--muted-foreground))"
                    fillOpacity={0.65}
                    pointerEvents="none"
                >
                    {`L${lap + 1}`}
                </text>,
            );
        }
    }

    return <g className="lap-guides">{nodes}</g>;
}

function ElevationOverlayHost({
    overlay,
    data,
    laps,
    leadInDistance,
}: {
    overlay: (ctx: RouteElevationOverlayContext) => ReactNode;
    data: DataPoint[];
    laps: number;
    leadInDistance: number | undefined;
}): ReactNode {
    const plotArea = usePlotArea();
    const xDomain = useXAxisDomain(0);
    const yDomain = useYAxisDomain(0);

    if (!plotArea || !isNumericDomain(xDomain) || !isNumericDomain(yDomain) || !data.length) {
        return null;
    }

    const [xMin, xMax] = xDomain;
    const [yMin, yMax] = yDomain;
    const xSpan = xMax - xMin || 1;
    const ySpan = yMax - yMin || 1;

    const xScale = (km: number) => plotArea.x + ((km - xMin) / xSpan) * plotArea.width;
    const yScale = (alt: number) =>
        plotArea.y + plotArea.height - ((alt - yMin) / ySpan) * plotArea.height;

    const totalDistanceKm = data[data.length - 1]?.distance ?? 0;
    const lapLengthKm = laps > 0 ? totalDistanceKm / laps : totalDistanceKm;
    const leadInKm = Number(leadInDistance) || 0;

    return overlay({
        lapLengthKm,
        totalDistanceKm,
        leadInKm,
        laps,
        xScale,
        yScale,
        altitudeAt: buildAltitudeAt(data),
        dataPoints: data,
        chartHeight: CHART_HEIGHT,
        plotTop: plotArea.y,
        plotBottom: plotArea.y + plotArea.height,
        plotLeft: plotArea.x,
        plotRight: plotArea.x + plotArea.width,
    });
}

function toRouteSegment(seg: {
    name?: string;
    type?: unknown;
    fromKm?: number;
    toKm?: number;
    from?: number;
    to?: number;
    direction?: string;
}): RouteSegment {
    const rawFrom = Number(seg.fromKm ?? seg.from) || 0;
    const rawTo = Number(seg.toKm ?? seg.to) || 0;
    return {
        from: Math.min(rawFrom, rawTo),
        to: Math.max(rawFrom, rawTo),
        type: normalizeSegmentType(seg.type),
        name: getSegmentName(seg.name),
        direction: normalizeDirection(seg.direction),
    };
}

export default function RouteElevationChart({
    worldName,
    routeName,
    laps = 1,
    routeId,
    pointSegments = [],
    extraProfileSegments = [],
    overlay,
    height = CHART_HEIGHT,
}: Props) {
    const { data: json, isLoading: loading } = useRouteElevationQuery(worldName, routeName, laps);
    const { data: eventSegments = [] } = useRaceSegmentsQuery(
        routeId,
        laps,
        !!routeId && pointSegments.length > 0,
    );

    const data: DataPoint[] | null = (() => {
        if (!json?.distance?.length || !json?.altitude?.length) return null;
        const n = Math.max(1, Math.floor(json.distance.length / TARGET_POINTS));
        const raw = json.distance
            .filter((_, i) => i % n === 0)
            .map((d, i) => ({
                distance: d / 1_000,
                altitude: json.altitude[i * n],
            }));
        return raw.map((pt, i) => ({
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
    })();

    const routeSegments: RouteSegment[] = useMemo(() => {
        if (!json && extraProfileSegments.length === 0) return [];
        const mergedProfile = mergeElevationProfileWithLapBanners(
            json,
            pointSegments,
            eventSegments,
            laps,
        );
        const fromRouteProfile: RouteSegment[] = mergedProfile.map(toRouteSegment);
        const extras = extraProfileSegments.map(toRouteSegment);
        const combined = [...fromRouteProfile, ...extras].sort(
            (a, b) => a.from - b.from || a.to - b.to,
        );
        if (combined.length > 0) return combined;
        return (json?.segments ?? []).map((seg) => toRouteSegment(seg));
    }, [json, extraProfileSegments, pointSegments, eventSegments, laps]);

    if (loading) {
        return (
            <div className="h-28 flex items-center justify-center text-muted-foreground text-xs">
                Henter ruteprofil…
            </div>
        );
    }

    if (!data) return null;

    const maxDist = data[data.length - 1]?.distance ?? 0;
    const distStep = getNiceStep(maxDist / 4);
    // Domain ends at the real route length — don't pad to the next nice tick.
    const xTicks: number[] = [];
    for (let t = 0; t < maxDist - distStep * 0.35; t += distStep) {
        xTicks.push(Number(t.toFixed(6)));
    }
    if (xTicks.length === 0 || Math.abs(xTicks[xTicks.length - 1] - maxDist) > 1e-6) {
        xTicks.push(maxDist);
    }

    const altitudes = data.map((d) => d.altitude);
    const minAlt = Math.min(...altitudes);
    const maxAlt = Math.max(...altitudes);
    const altRange = maxAlt - minAlt || 1;
    const altStep = Math.ceil(altRange / 4 / 10) * 10 || 10;
    const altBase = Math.floor(minAlt / altStep) * altStep;
    // Nice ticks can undershoot maxAlt (e.g. peak 130m with top tick 120m);
    // grow the domain so the profile and overlays share the same top.
    const altTop = Math.max(altBase + altStep * 4, Math.ceil(maxAlt / altStep) * altStep);
    const yTicks: number[] = [];
    for (let t = altBase; t <= altTop + 1e-9; t += altStep) {
        yTicks.push(t);
    }
    const pointSegmentOccurrenceKeys = new Set(
        (pointSegments || []).map((s) => {
            const base = normalizeNameForMatch(s.name);
            const dir = normalizeDirectionForMatch(s.direction, s.name);
            const occ = Number.isFinite(s.count) && s.count > 0 ? s.count : 1;
            return `${base}::${dir}::${occ}`;
        }),
    );
    const routeOccurrenceCounters = new Map<string, number>();
    const routeOccurrenceKeys = routeSegments.map((seg) => {
        const base = normalizeNameForMatch(seg.name);
        const dir = normalizeDirectionForMatch(seg.direction, seg.name);
        const keyBase = `${base}::${dir}`;
        const next = (routeOccurrenceCounters.get(keyBase) || 0) + 1;
        routeOccurrenceCounters.set(keyBase, next);
        return `${keyBase}::${next}`;
    });

    // Clamp to chart domain. Catalog finish segments often overshoot route length
    // slightly (e.g. Itza KOM 46.1 km on a 45.8 km route); with domain=[0,dataMax]
    // Recharts drops ReferenceAreas that extend past the axis.
    // Zero-width / near-zero lap banners render as ReferenceLine instead.
    const visibleRouteSegments = routeSegments
        .map((seg, i) => {
            const from = Math.max(0, Math.min(seg.from, maxDist));
            const to = Math.max(0, Math.min(seg.to, maxDist));
            const width = to - from;
            if (width < 0) return null;
            const isPointBanner = width <= POINT_BANNER_EPSILON_KM;
            if (!isPointBanner && !(to > from)) return null;
            return { seg, i, from, to, isPointBanner };
        })
        .filter(
            (v): v is { seg: RouteSegment; i: number; from: number; to: number; isPointBanner: boolean } =>
                v != null,
        );

    return (
        <div>
            <div style={{ width: '100%', height }}>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data} margin={{ top: 8, right: 6, bottom: 4, left: 0 }} baseValue="dataMin">
                        <defs>
                            <linearGradient id="elevGrad" x1="0" y1="0" x2="0" y2="100%">
                                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.6} />
                                <stop offset="65%" stopColor="hsl(var(--primary))" stopOpacity={0.28} />
                                <stop offset="100%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0.2} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} strokeOpacity={0.15} />
                        {laps > 1 && (
                            <Customized
                                component={<LapDivisionLayer data={data} laps={laps} layer="bands" />}
                            />
                        )}
                        <XAxis
                            dataKey="distance"
                            type="number"
                            domain={[0, 'dataMax']}
                            ticks={xTicks}
                            tickFormatter={(v, i) => {
                                const isLast = i === xTicks.length - 1;
                                const label = Number.isInteger(v) || Math.abs(v - Math.round(v)) < 0.05
                                    ? `${Math.round(v)}`
                                    : v.toFixed(1);
                                return isLast ? `${label} km` : label;
                            }}
                            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                            tickLine={false}
                            axisLine={false}
                        />
                        <YAxis
                            type="number"
                            domain={[altBase, altTop]}
                            ticks={yTicks}
                            tickFormatter={(v, i) => i === 0 ? `${v} m` : `${v}`}
                            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                            tickLine={false}
                            axisLine={false}
                            width={30}
                        />
                        <Tooltip
                            content={(props) => (
                                <ElevationTooltip
                                    {...props}
                                    routeSegments={routeSegments}
                                    pointSegmentOccurrenceKeys={pointSegmentOccurrenceKeys}
                                    routeOccurrenceKeys={routeOccurrenceKeys}
                                />
                            )}
                            isAnimationActive={false}
                        />

                        {visibleRouteSegments.map(({ seg, i, from, to, isPointBanner }) => {
                                const isPointSegment = pointSegmentOccurrenceKeys.has(routeOccurrenceKeys[i]);
                                const color = SEGMENT_COLORS[normalizeSegmentType(seg.type)];
                                const label = compactSegmentLabel(seg.name, seg.direction);
                                if (isPointBanner) {
                                    const x = from;
                                    return (
                                        <ReferenceLine
                                            key={i}
                                            x={x}
                                            stroke={color}
                                            strokeOpacity={0.85}
                                            strokeWidth={2}
                                            label={(labelProps) =>
                                                renderCenteredSegmentLabel(
                                                    {
                                                        ...labelProps,
                                                        viewBox: labelProps?.viewBox
                                                            ? {
                                                                  ...labelProps.viewBox,
                                                                  width: Math.max(labelProps.viewBox.width || 0, 12),
                                                                  x: (labelProps.viewBox.x ?? 0) - 6,
                                                              }
                                                            : labelProps?.viewBox,
                                                    },
                                                    label,
                                                    color,
                                                    isPointSegment || isPointBanner,
                                                )
                                            }
                                        />
                                    );
                                }
                                return (
                            <ReferenceArea
                                key={i}
                                x1={from}
                                x2={to}
                                // Omit y1/y2 so the band fills the full plot height.
                                fill={color}
                                fillOpacity={0.25}
                                stroke={color}
                                strokeOpacity={0.6}
                                strokeWidth={1}
                                label={(labelProps) =>
                                    renderCenteredSegmentLabel(
                                        labelProps,
                                        label,
                                        color,
                                        isPointSegment,
                                    )
                                }
                            />
                                );
                        })}

                        <Area
                            type="monotone"
                            dataKey="altitude"
                            stroke="hsl(var(--primary))"
                            strokeWidth={1.5}
                            fill="url(#elevGrad)"
                            dot={false}
                            isAnimationActive={false}
                        />

                        {laps > 1 && (
                            <Customized
                                component={<LapDivisionLayer data={data} laps={laps} layer="guides" />}
                            />
                        )}

                        {overlay && data && (
                            <Customized
                                component={
                                    <ElevationOverlayHost
                                        overlay={overlay}
                                        data={data}
                                        laps={laps}
                                        leadInDistance={json?.leadInDistance}
                                    />
                                }
                            />
                        )}
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
