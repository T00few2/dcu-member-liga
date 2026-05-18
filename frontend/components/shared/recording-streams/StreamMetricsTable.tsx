'use client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SimilarityResult {
    samples: number;
    overlapSec: number;
    meanAbsDiff: number;
    p95Diff: number;
    maxDiff: number;
    stdDiff: number;
    stdDeltaDiff: number;
    nearIdenticalPct: number;
    longestNearIdenticalRunSec: number;
    suspiciousByVolatility: boolean;
    suspiciousByRun: boolean;
    suspicious: boolean;
}

const IDENTICAL_TOLERANCE_W = 3;

interface StreamMetricsTableProps {
    similarity: SimilarityResult;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function StreamMetricsTable({ similarity }: StreamMetricsTableProps) {
    return (
        <div className={`mt-3 rounded-md border px-3 py-2 text-xs ${
            similarity.suspicious
                ? 'border-amber-300 bg-amber-50 text-amber-900'
                : 'border-border bg-muted/20 text-muted-foreground'
        }`}>
            <div className="font-semibold mb-1">Power similarity check</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <div>Mean |diff|: <span className="font-mono">{similarity.meanAbsDiff.toFixed(1)} W</span></div>
                <div>P95 diff: <span className="font-mono">{similarity.p95Diff.toFixed(1)} W</span></div>
                <div>Max diff: <span className="font-mono">{similarity.maxDiff.toFixed(1)} W</span></div>
                <div>Samples: <span className="font-mono">{similarity.samples}</span></div>
                <div>Overlap: <span className="font-mono">{Math.round(similarity.overlapSec)}s</span></div>
                <div>Std(diff): <span className="font-mono">{similarity.stdDiff.toFixed(2)} W</span></div>
                <div>Std(Δdiff): <span className="font-mono">{similarity.stdDeltaDiff.toFixed(2)} W</span></div>
                <div>
                    Near-identical (&lt;={IDENTICAL_TOLERANCE_W}W):{' '}
                    <span className="font-mono">{similarity.nearIdenticalPct.toFixed(1)}%</span>
                </div>
                <div>
                    Longest near-identical run:{' '}
                    <span className="font-mono">{Math.round(similarity.longestNearIdenticalRunSec)}s</span>
                </div>
            </div>
            <div className="mt-1">
                {similarity.suspicious
                    ? `Suspiciously similar power traces (${similarity.suspiciousByVolatility ? 'volatility' : 'run-length'} trigger). This can indicate shared recording source.`
                    : 'Similarity level looks plausible for independent recordings.'}
            </div>
        </div>
    );
}
