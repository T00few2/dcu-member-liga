'use client';

import { useMemo, useState } from 'react';
import { analyzeStickyWatts, type StickyWattsThresholds } from '@/lib/stickyWatts';
import { useStickyWattsThresholds } from '@/hooks/useStickyWattsThresholds';

interface Props {
    stream: {
        time: number[];
        watts: (number | null)[];
    };
}

function ThresholdInput({
    label,
    unit,
    value,
    onChange,
    min,
    max,
}: {
    label: string;
    unit: string;
    value: number;
    onChange: (v: number) => void;
    min: number;
    max: number;
}) {
    return (
        <label className="flex items-center gap-2 text-xs">
            <span className="w-40 shrink-0 text-muted-foreground">{label}</span>
            <input
                type="number"
                min={min}
                max={max}
                value={value}
                onChange={e => onChange(Number(e.target.value))}
                className="w-20 rounded border border-border bg-background px-2 py-0.5 text-right font-mono text-foreground"
            />
            <span className="text-muted-foreground">{unit}</span>
        </label>
    );
}

export default function StickyWattsPanel({ stream }: Props) {
    const { thresholds, setThresholds, save, saving, saveError } = useStickyWattsThresholds();
    const [showThresholds, setShowThresholds] = useState(false);

    const result = useMemo(
        () => analyzeStickyWatts(stream.time, stream.watts, thresholds),
        [stream.time, stream.watts, thresholds],
    );

    const set = (key: keyof StickyWattsThresholds) => (v: number) =>
        setThresholds({ ...thresholds, [key]: v });

    return (
        <div className={`rounded-md border px-3 py-3 text-xs ${
            result.suspicious
                ? 'border-amber-300 bg-amber-50 text-amber-900'
                : 'border-border bg-muted/20 text-muted-foreground'
        }`}>
            {/* Verdict row */}
            <div className="flex items-center justify-between mb-2">
                <span className="font-semibold">
                    {result.suspicious ? '⚠ Mistænkelig' : '✓ OK'}
                </span>
                <span className="text-[10px] font-normal opacity-60">Eksperimentel</span>
            </div>

            {/* Metrics grid */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-3">
                <div>Total samples: <span className="font-mono">{result.totalSamples}</span></div>
                <div>Non-zero (&gt;{thresholds.minWatts}W): <span className="font-mono">{result.nonZeroSamples}</span></div>
                <div>
                    Identical pairs:{' '}
                    <span className={`font-mono font-semibold ${result.identicalPairPct >= thresholds.suspiciousPairPct ? 'text-amber-700' : ''}`}>
                        {result.identicalPairPct.toFixed(1)}%
                    </span>
                    <span className="opacity-60"> (lim: {thresholds.suspiciousPairPct}%)</span>
                </div>
                <div>Sticky runs (≥{thresholds.minRun}s): <span className="font-mono">{result.stickyRuns}</span></div>
                <div>Longest run: <span className="font-mono">{result.maxRunLength}s</span></div>
                <div>
                    Pre-zero events:{' '}
                    <span className={`font-mono font-semibold ${result.preZeroEvents >= thresholds.suspiciousPreZero ? 'text-amber-700' : ''}`}>
                        {result.preZeroEvents}
                    </span>
                    <span className="opacity-60"> (lim: {thresholds.suspiciousPreZero})</span>
                </div>
            </div>

            {/* Thresholds toggle */}
            <button
                onClick={() => setShowThresholds(v => !v)}
                className="text-[10px] underline underline-offset-2 opacity-60 hover:opacity-100 transition-opacity"
            >
                {showThresholds ? 'Skjul tærskler' : 'Juster tærskler'}
            </button>

            {showThresholds && (
                <div className="mt-2 space-y-1.5 border-t border-current/20 pt-2">
                    <ThresholdInput label="Min. watt (aktiv)" unit="W" value={thresholds.minWatts} onChange={set('minWatts')} min={10} max={400} />
                    <ThresholdInput label="Min. run-længde" unit="s" value={thresholds.minRun} onChange={set('minRun')} min={2} max={30} />
                    <ThresholdInput label="Drop-til-nul (<)" unit="W" value={thresholds.zeroThresh} onChange={set('zeroThresh')} min={1} max={100} />
                    <ThresholdInput label="Mistænkelig par-%" unit="%" value={thresholds.suspiciousPairPct} onChange={set('suspiciousPairPct')} min={5} max={100} />
                    <ThresholdInput label="Mistænkelige pre-zero" unit="hændelser" value={thresholds.suspiciousPreZero} onChange={set('suspiciousPreZero')} min={1} max={20} />

                    <div className="flex items-center gap-2 pt-1">
                        <button
                            onClick={() => void save()}
                            disabled={saving}
                            className="text-[10px] px-2 py-0.5 rounded border border-current/40 hover:bg-current/10 disabled:opacity-50 transition-colors"
                        >
                            {saving ? 'Gemmer...' : 'Gem som standard'}
                        </button>
                        {saveError && <span className="text-red-600 text-[10px]">{saveError}</span>}
                    </div>
                </div>
            )}
        </div>
    );
}
