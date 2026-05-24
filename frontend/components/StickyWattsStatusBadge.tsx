'use client';

import { useState } from 'react';
import type { StickyWattsResult } from '@/lib/stickyWatts';

interface Props {
    stickyWatts: StickyWattsResult | null | undefined;
    trainerName?: string | null;
}

function MetricsGrid({ sw }: { sw: StickyWattsResult }) {
    return (
        <div className="space-y-3">
            <div className={`rounded-md border px-3 py-2 text-xs ${
                sw.suspicious
                    ? 'border-amber-300 bg-amber-50 text-amber-900'
                    : 'border-border bg-muted/20 text-muted-foreground'
            }`}>
                <div className="font-semibold mb-1">
                    {sw.suspicious ? '⚠ Mærkelig' : '✓ OK'}
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                    <div>Total samples: <span className="font-mono">{sw.totalSamples}</span></div>
                    <div>Non-zero (&gt;100W): <span className="font-mono">{sw.nonZeroSamples}</span></div>
                    <div>Identical pairs: <span className={`font-mono font-semibold ${sw.identicalPairPct >= 25 ? 'text-amber-700' : ''}`}>{sw.identicalPairPct.toFixed(1)}%</span></div>
                    <div>Sticky runs (≥3s): <span className="font-mono">{sw.stickyRuns}</span></div>
                    <div>Longest run: <span className="font-mono">{sw.maxRunLength}s</span></div>
                    <div>Pre-zero events: <span className={`font-mono font-semibold ${sw.preZeroEvents >= 2 ? 'text-amber-700' : ''}`}>{sw.preZeroEvents}</span></div>
                </div>
            </div>
            <p className="text-xs text-muted-foreground">
                Beregnet med standardværdier (100W / 3s / 20W).
                Juster tærskler i Performance Analysis for live genberegning.
            </p>
        </div>
    );
}

export default function StickyWattsStatusBadge({ stickyWatts, trainerName }: Props) {
    const [open, setOpen] = useState(false);

    if (!stickyWatts) return null;

    const { suspicious, totalSamples } = stickyWatts;

    const noData = totalSamples === 0;
    const colorClass = noData
        ? 'bg-slate-100 text-slate-400 border-slate-300 cursor-default'
        : suspicious
            ? 'bg-amber-100 text-amber-700 border-amber-300 hover:bg-amber-200'
            : 'bg-green-100 text-green-700 border-green-300 hover:bg-green-200';
    const icon = noData ? '–' : suspicious ? '⚠' : '✓';
    const title = noData
        ? 'Sticky Watts: Ingen streamdata tilgængelig'
        : suspicious ? 'Sticky Watts: Mærkelig' : 'Sticky Watts: OK';

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
                                <h2 className="text-base font-bold text-foreground">Sticky Watts</h2>
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
                            <MetricsGrid sw={stickyWatts} />
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
