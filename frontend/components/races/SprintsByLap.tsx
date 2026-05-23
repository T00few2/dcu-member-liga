'use client';

import type { Sprint } from '@/types/live';

export interface SprintsByLapProfileSegment {
    name: string;
    type: string;
    fromKm: number;
    toKm: number;
    direction?: string;
}

export interface SprintsByLapProfileData {
    leadInDistance: number;
    profileSegments: SprintsByLapProfileSegment[];
}

const normalize = (value?: string | null) => (value || '').trim().toLowerCase();

export function normalizeSprintNameForMatch(name?: string): string {
    return (name || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()
        .replace(/['’`]/g, ' ')
        .replace(/\s+\(.*\)\s*$/g, '')
        .replace(/\s+(reverse|rev\.?)$/g, '')
        .replace(/[^a-z0-9\s-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function normalizeSprintDirectionForMatch(direction?: string, name?: string): 'forward' | 'reverse' {
    const d = (direction || '').trim().toLowerCase();
    if (d === 'reverse' || d === 'rev' || d === 'r') return 'reverse';
    if (d === 'forward' || d === 'f') return 'forward';
    const n = (name || '').toLowerCase();
    if (n.includes('reverse') || n.includes(' rev')) return 'reverse';
    return 'forward';
}

function buildProfileSegmentIndex(
    profileSegments: SprintsByLapProfileSegment[],
): Map<string, SprintsByLapProfileSegment> {
    const counters = new Map<string, number>();
    const index = new Map<string, SprintsByLapProfileSegment>();
    for (const seg of profileSegments) {
        const base = normalizeSprintNameForMatch(seg.name);
        const dir = normalizeSprintDirectionForMatch(seg.direction, seg.name);
        const keyBase = `${base}::${dir}`;
        const count = (counters.get(keyBase) || 0) + 1;
        counters.set(keyBase, count);
        index.set(`${keyBase}::${count}`, seg);
    }
    return index;
}

interface Props {
    sprints: Sprint[];
    profileData: SprintsByLapProfileData | null;
}

export default function SprintsByLap({ sprints, profileData }: Props) {
    const sprintLabel = (seg: Sprint) => {
        const isReverse = normalize(seg.direction) === 'reverse';
        return isReverse ? `${seg.name} Reverse` : seg.name;
    };

    const profileIndex = profileData ? buildProfileSegmentIndex(profileData.profileSegments) : null;
    const leadIn = profileData?.leadInDistance ?? 0;

    // profileSegments are tiled by the API (one entry per lap), so the occurrence count
    // in the index equals the lap number for segments appearing once per lap.
    const getKmFromTo = (seg: Sprint): { from: string; to: string } | null => {
        if (!profileIndex) return null;
        const base = normalizeSprintNameForMatch(seg.name);
        const dir = normalizeSprintDirectionForMatch(seg.direction, seg.name);
        const lap = seg.lap || 1;
        const match = profileIndex.get(`${base}::${dir}::${lap}`);
        if (!match) return null;
        return {
            from: (Math.min(match.fromKm, match.toKm) + leadIn).toFixed(1),
            to: (Math.max(match.fromKm, match.toKm) + leadIn).toFixed(1),
        };
    };

    const getFromKmValue = (seg: Sprint): number => {
        if (!profileIndex) return Infinity;
        const base = normalizeSprintNameForMatch(seg.name);
        const dir = normalizeSprintDirectionForMatch(seg.direction, seg.name);
        const lap = seg.lap || 1;
        const match = profileIndex.get(`${base}::${dir}::${lap}`);
        if (!match) return Infinity;
        return Math.min(match.fromKm, match.toKm) + leadIn;
    };

    const rows = [...sprints].sort((a, b) => {
        const aFrom = getFromKmValue(a);
        const bFrom = getFromKmValue(b);
        if (aFrom !== bFrom) return aFrom - bFrom;
        const lapDiff = (a.lap || 1) - (b.lap || 1);
        if (lapDiff !== 0) return lapDiff;
        return a.count - b.count;
    });

    const hasKmData = rows.some((s) => getKmFromTo(s) !== null);

    return (
        <div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                    <thead>
                        <tr className="border-b border-border">
                            <th className="text-left py-1.5 pr-4 font-medium text-muted-foreground text-xs uppercase tracking-wide">Sprint</th>
                            <th className="text-center py-1.5 px-3 font-medium text-muted-foreground text-xs uppercase tracking-wide whitespace-nowrap">Omgang</th>
                            {hasKmData && (
                                <>
                                    <th className="text-right py-1.5 px-3 font-medium text-muted-foreground text-xs uppercase tracking-wide whitespace-nowrap">Fra km</th>
                                    <th className="text-right py-1.5 pl-3 font-medium text-muted-foreground text-xs uppercase tracking-wide whitespace-nowrap">Til km</th>
                                </>
                            )}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((seg, idx) => {
                            const kmFromTo = getKmFromTo(seg);
                            return (
                                <tr key={idx} className="border-b border-border/50 last:border-0">
                                    <td className="py-1.5 pr-4 font-medium text-card-foreground">{sprintLabel(seg)}</td>
                                    <td className="py-1.5 px-3 text-center text-muted-foreground">{seg.lap || 1}</td>
                                    {hasKmData && (
                                        <>
                                            <td className="py-1.5 px-3 text-right font-mono text-card-foreground">
                                                {kmFromTo ? `${kmFromTo.from}` : '—'}
                                            </td>
                                            <td className="py-1.5 pl-3 text-right font-mono text-card-foreground">
                                                {kmFromTo ? `${kmFromTo.to}` : '—'}
                                            </td>
                                        </>
                                    )}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            {hasKmData && leadIn > 0 && (
                <p className="text-xs text-muted-foreground mt-2">
                    Distancer inkl lead-in ({leadIn.toFixed(1)} km)
                </p>
            )}
            {hasKmData && leadIn === 0 && (
                <p className="text-xs text-muted-foreground mt-2">
                    Distancer inkl lead-in
                </p>
            )}
        </div>
    );
}
