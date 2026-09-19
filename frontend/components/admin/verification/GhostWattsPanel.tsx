'use client';

import { useMemo, useState } from 'react';
import { analyzeGhostWatts, type GhostWattsThresholds } from '@/lib/ghostWatts';
import { useGhostWattsThresholds } from '@/hooks/useGhostWattsThresholds';
import { GhostWattsProvider, useGhostWattsContext } from '@/lib/gw-context';

interface Props {
    stream: {
        time: number[];
        watts: (number | null)[];
        cadence: (number | null)[];
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

function GhostWattsPanelInner() {
    const { stream } = useGhostWattsContext();
    const { thresholds, setThresholds, save, saving, saveError } = useGhostWattsThresholds();
    const [showThresholds, setShowThresholds] = useState(false);

    const result = useMemo(
        () => analyzeGhostWatts(stream.time, stream.watts, stream.cadence, thresholds),
        [stream.time, stream.watts, stream.cadence, thresholds],
    );

    const set = (key: keyof GhostWattsThresholds) => (v: number) =>
        setThresholds({ ...thresholds, [key]: v });

    const flagged = result.suspicious;
    const muted = result.insufficientCadence;

    return (
        <div className={`rounded-md border px-3 py-3 text-xs ${
            flagged
                ? 'border-amber-300 bg-amber-50 text-amber-900'
                : 'border-border bg-muted/20 text-muted-foreground'
        }`}>
            <div className="flex items-center justify-between mb-2">
                <span className="font-semibold">
                    {muted ? '– Ingen cadence' : flagged ? '⚠ Mærkelig' : '✓ OK'}
                </span>
                <span className="text-[10px] font-normal opacity-60">Eksperimentel</span>
            </div>

            {muted ? (
                <p className="mb-3 opacity-80">
                    Cadence-stream mangler eller ser ud til at være 0 rpm under hele rittet.
                    Ghost watts kan ikke vurderes uden reel cadence.
                </p>
            ) : (
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-3">
                    <div>Total samples: <span className="font-mono">{result.totalSamples}</span></div>
                    <div>Zero-cadence: <span className="font-mono">{result.zeroCadenceSeconds}s</span></div>
                    <div>
                        Ghost share:{' '}
                        <span className="font-mono font-semibold">{result.ghostShareOfZeroCadence.toFixed(1)}%</span>
                    </div>
                    <div>Ghost events (≥{thresholds.minRun}s): <span className="font-mono">{result.ghostEvents}</span></div>
                    <div>
                        Ghost seconds:{' '}
                        <span className={`font-mono font-semibold ${result.ghostSeconds >= thresholds.minGhostSeconds ? 'text-amber-700' : ''}`}>
                            {result.ghostSeconds}s
                        </span>
                        <span className="opacity-60"> (lim: {thresholds.minGhostSeconds}s)</span>
                    </div>
                    <div>
                        Floor (median):{' '}
                        <span className={`font-mono font-semibold ${result.medianGhostWatts >= thresholds.suspiciousFloorW ? 'text-amber-700' : ''}`}>
                            {result.medianGhostWatts.toFixed(1)}W
                        </span>
                        <span className="opacity-60"> (lim: {thresholds.suspiciousFloorW}W)</span>
                    </div>
                    <div>Max ghost: <span className="font-mono">{result.maxGhostWatts}W</span></div>
                    <div>
                        Events:{' '}
                        <span className={`font-mono ${result.ghostEvents >= thresholds.minGhostEvents ? 'text-amber-700 font-semibold' : ''}`}>
                            {result.ghostEvents}
                        </span>
                        <span className="opacity-60"> (lim: {thresholds.minGhostEvents})</span>
                    </div>
                </div>
            )}

            <p className="mb-2 text-[10px] opacity-70">
                Ser kun Zwift FIT. Hvis Zwift selv opfinder cadence (10–25 W / ~120 rpm mens
                traineren står stille), fanges det ikke her — brug dual recording vs Strava.
            </p>

            <button
                onClick={() => setShowThresholds(v => !v)}
                className="text-[10px] underline underline-offset-2 opacity-60 hover:opacity-100 transition-opacity"
            >
                {showThresholds ? 'Skjul tærskler' : 'Juster tærskler'}
            </button>

            {showThresholds && (
                <div className="mt-2 space-y-1.5 border-t border-current/20 pt-2">
                    <ThresholdInput label="Cadence ≈ 0 (<)" unit="rpm" value={thresholds.cadZeroThresh} onChange={set('cadZeroThresh')} min={1} max={20} />
                    <ThresholdInput label="Min. ghost-watt" unit="W" value={thresholds.minGhostWatts} onChange={set('minGhostWatts')} min={1} max={50} />
                    <ThresholdInput label="Min. run-længde" unit="s" value={thresholds.minRun} onChange={set('minRun')} min={2} max={30} />
                    <ThresholdInput label="Mærkelige sekunder" unit="s" value={thresholds.minGhostSeconds} onChange={set('minGhostSeconds')} min={5} max={120} />
                    <ThresholdInput label="Mærkelige events" unit="hændelser" value={thresholds.minGhostEvents} onChange={set('minGhostEvents')} min={1} max={20} />
                    <ThresholdInput label="Mærkelig floor" unit="W" value={thresholds.suspiciousFloorW} onChange={set('suspiciousFloorW')} min={5} max={80} />

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

export default function GhostWattsPanel({ stream }: Props) {
    return (
        <GhostWattsProvider stream={stream}>
            <GhostWattsPanelInner />
        </GhostWattsProvider>
    );
}
