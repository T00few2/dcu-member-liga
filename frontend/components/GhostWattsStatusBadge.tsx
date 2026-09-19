'use client';

import { useState } from 'react';
import type { GhostWattsResult } from '@/lib/ghostWatts';

interface Props {
    ghostWatts: GhostWattsResult | null | undefined;
    trainerName?: string | null;
}

function MetricsGrid({ gw }: { gw: GhostWattsResult }) {
    return (
        <div className="space-y-3">
            <div className={`rounded-md border px-3 py-2 text-xs ${
                gw.suspicious
                    ? 'border-amber-300 bg-amber-50 text-amber-900'
                    : 'border-border bg-muted/20 text-muted-foreground'
            }`}>
                <div className="font-semibold mb-1">
                    {gw.insufficientCadence ? '– Ingen cadence' : gw.suspicious ? '⚠ Mærkelig' : '✓ OK'}
                </div>
                {gw.insufficientCadence ? (
                    <p>Cadence-stream mangler eller er 0 rpm under hele rittet.</p>
                ) : (
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                        <div>Total samples: <span className="font-mono">{gw.totalSamples}</span></div>
                        <div>Zero-cadence: <span className="font-mono">{gw.zeroCadenceSeconds}s</span></div>
                        <div>Ghost share: <span className="font-mono font-semibold">{gw.ghostShareOfZeroCadence.toFixed(1)}%</span></div>
                        <div>Ghost events (≥3s): <span className="font-mono">{gw.ghostEvents}</span></div>
                        <div>Ghost seconds: <span className={`font-mono font-semibold ${gw.ghostSeconds >= 20 ? 'text-amber-700' : ''}`}>{gw.ghostSeconds}s</span></div>
                        <div>Floor (median): <span className={`font-mono font-semibold ${gw.medianGhostWatts >= 10 ? 'text-amber-700' : ''}`}>{gw.medianGhostWatts.toFixed(1)}W</span></div>
                        <div>Max ghost: <span className="font-mono">{gw.maxGhostWatts}W</span></div>
                    </div>
                )}
            </div>
            <p className="text-xs text-muted-foreground">
                Beregnet med standardværdier (5 rpm / 8 W / 3 s / floor 10 W).
                Juster tærskler i Performance Analysis for live genberegning.
                Analysen ser kun Zwift FIT og kan ikke se Zwift-klientens opfundne cadence.
            </p>
        </div>
    );
}

export default function GhostWattsStatusBadge({ ghostWatts, trainerName }: Props) {
    const [open, setOpen] = useState(false);

    if (!ghostWatts) return null;

    const { suspicious, totalSamples, insufficientCadence } = ghostWatts;
    const noData = totalSamples === 0;
    const muted = noData || insufficientCadence;
    const colorClass = muted
        ? `bg-slate-100 text-slate-400 border-slate-300 ${noData ? 'cursor-default' : 'hover:bg-slate-200'}`
        : suspicious
            ? 'bg-amber-100 text-amber-700 border-amber-300 hover:bg-amber-200'
            : 'bg-green-100 text-green-700 border-green-300 hover:bg-green-200';
    const icon = muted ? '–' : suspicious ? '⚠' : '✓';
    const title = noData
        ? 'Ghost Watts: Ingen streamdata tilgængelig'
        : insufficientCadence
            ? 'Ghost Watts: Ingen cadence'
            : suspicious ? 'Ghost Watts: Mærkelig' : 'Ghost Watts: OK';

    return (
        <>
            <button
                onClick={() => { if (!noData) setOpen(true); }}
                title={title}
                className={`inline-flex items-center justify-center w-6 h-6 rounded-full border text-xs font-bold transition-colors ${noData ? '' : 'cursor-pointer'} ${colorClass}`}
                aria-label={title}
            >
                {icon}
            </button>

            {open && !noData && (
                <div
                    className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
                    onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
                >
                    <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-sm">
                        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                            <div>
                                <h2 className="text-base font-bold text-foreground">Ghost Watts</h2>
                                <p className="text-xs text-muted-foreground">Automatisk analyse (eksperimentel)</p>
                                {trainerName && (
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        Trainer: <span className="font-medium text-foreground">{trainerName}</span>
                                    </p>
                                )}
                            </div>
                            <button
                                onClick={() => setOpen(false)}
                                className="text-muted-foreground hover:text-foreground text-xl leading-none px-2"
                                aria-label="Luk"
                            >
                                ×
                            </button>
                        </div>
                        <div className="px-5 py-4">
                            <MetricsGrid gw={ghostWatts} />
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
