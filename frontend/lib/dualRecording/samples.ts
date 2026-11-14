export interface DualSample {
    t: number;
    watts: number | null;
    cadence: number | null;
    hr: number | null;
    trainerWatts?: number | null;
}

export interface DualSummary {
    durationSec: number;
    avgPower: number | null;
    avgCadence: number | null;
    avgHr: number | null;
    powerCoveragePct: number;
}

function mean(values: Array<number | null | undefined>): number | null {
    const present = values.filter((value): value is number => value != null && Number.isFinite(value));
    if (!present.length) return null;
    return Math.round((present.reduce((sum, value) => sum + value, 0) / present.length) * 10) / 10;
}

export function summarizeSamples(samples: DualSample[]): DualSummary {
    if (!samples.length) {
        return { durationSec: 0, avgPower: null, avgCadence: null, avgHr: null, powerCoveragePct: 0 };
    }
    const ordered = [...samples].sort((a, b) => a.t - b.t);
    const durationSec = Math.max(0, Math.round((ordered[ordered.length - 1].t - ordered[0].t) / 1000));
    let covered = 0;
    for (let i = 1; i < ordered.length; i += 1) {
        if (ordered[i - 1].watts != null) {
            covered += Math.max(0, Math.round((ordered[i].t - ordered[i - 1].t) / 1000));
        }
    }
    const span = durationSec || (ordered.length ? 1 : 0);
    const powerCoveragePct = span ? Math.round((1000 * Math.min(covered, span)) / span) / 10 : 0;
    return {
        durationSec,
        avgPower: mean(ordered.map((sample) => sample.watts)),
        avgCadence: mean(ordered.map((sample) => sample.cadence)),
        avgHr: mean(ordered.map((sample) => sample.hr)),
        powerCoveragePct,
    };
}

export interface StoredSession {
    raceId: string;
    samples: DualSample[];
    devices: { powerMeter?: string; heartRate?: string; trainer?: string };
    updatedAt: number;
}

export function canResume(session: StoredSession | null | undefined, raceId: string): boolean {
    return Boolean(session && session.raceId === raceId && session.samples.length > 0);
}
