'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useDualRecord } from '@/components/dual-record/DualRecordProvider';
import FinishHoldButton from '@/components/dual-record/FinishHoldButton';
import { DUAL_EXPERIMENTAL_DA, DUAL_PAIRING_DA } from '@/lib/dualRecording/copy';
import { browserCanRecord } from '@/lib/dualRecording/window';

export default function DualRecorderScreen({ raceId }: { raceId: string }) {
    const record = useDualRecord();
    const [ready, setReady] = useState(false);
    useEffect(() => { record.bind(raceId); }, [raceId, record.bind]);
    useEffect(() => { setReady(true); }, []);

    if (!ready) return null;

    if (!browserCanRecord()) {
        return (
            <div className="mx-auto max-w-lg px-4 py-10 space-y-4">
                <p className="text-sm text-amber-800 dark:text-amber-200">{DUAL_EXPERIMENTAL_DA}</p>
                <p>Denne browser kan ikke forbinde til wattmålere. Brug Chrome på en Android-telefon eller en computer, eller upload FIT-filen under verifikation.</p>
                <Link href="/verification" className="text-primary underline">Gå til verifikation</Link>
            </div>
        );
    }

    const { phase, live, summary, error, resumed } = record;
    return (
        <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 py-6">
            <p className="text-sm text-amber-800 dark:text-amber-200">{DUAL_EXPERIMENTAL_DA}</p>
            <p className="text-sm text-muted-foreground">{DUAL_PAIRING_DA}</p>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {resumed && phase === 'summary' && (
                <p className="text-sm">Der ligger en gemt optagelse på enheden. Du kan sende den, eller starte forfra ved at forbinde igen og trykke Start.</p>
            )}

            {(phase === 'idle' || phase === 'arming' || phase === 'recording' || (phase === 'summary' && resumed)) && (
                <>
                    <div className="grid gap-2">
                        <ConnectButton label="Forbind wattmåler" done={live.pmConnected} onClick={() => void record.connectPower()} />
                        <ConnectButton label="Forbind pulsmåler" done={live.hrConnected} onClick={() => void record.connectHeartRate()} />
                        <ConnectButton label="Forbind træner (valgfrit)" done={live.trainerConnected} onClick={() => void record.connectTrainer()} />
                    </div>
                    <div className="flex flex-1 flex-col items-center justify-center py-8">
                        {phase === 'recording' && !live.pmConnected ? (
                            <button type="button" className="text-3xl font-bold underline" onClick={() => void record.reconnectPower()}>
                                Genforbind
                            </button>
                        ) : (
                            <div className="text-7xl font-bold tabular-nums">{live.watts ?? '—'}</div>
                        )}
                        <div className="mt-4 text-xl text-muted-foreground">
                            {live.cadence ?? '—'} rpm · {live.hr ?? '—'} bpm
                        </div>
                    </div>
                    {phase === 'recording' ? (
                        <FinishHoldButton onFinish={record.finish} />
                    ) : phase === 'summary' ? null : (
                        <button
                            type="button"
                            disabled={!live.pmLive || !live.hrLive}
                            onClick={() => void record.start()}
                            className="w-full rounded-lg bg-primary py-4 text-lg font-bold text-primary-foreground disabled:opacity-50"
                        >
                            Start
                        </button>
                    )}
                </>
            )}

            {(phase === 'summary' || phase === 'uploading' || phase === 'uploaded') && summary && (
                <div className="space-y-3 rounded-lg border border-border p-4">
                    <h2 className="text-lg font-bold">Opsummering</h2>
                    <SummaryLine label="Tid" value={`${summary.durationSec} sek`} />
                    <SummaryLine label="Watt" value={summary.avgPower != null ? `${summary.avgPower} W` : '—'} />
                    <SummaryLine label="Kadence" value={summary.avgCadence != null ? `${summary.avgCadence} rpm` : '—'} />
                    <SummaryLine label="Puls" value={summary.avgHr != null ? `${summary.avgHr} bpm` : '—'} />
                    <SummaryLine label="Andel med watt" value={`${summary.powerCoveragePct} %`} />
                    {resumed && phase === 'summary' && (
                        <button
                            type="button"
                            disabled={!live.pmLive || !live.hrLive}
                            onClick={record.resumeRecording}
                            className="w-full rounded-lg border border-border py-3 font-semibold disabled:opacity-50"
                        >
                            Fortsæt optagelse
                        </button>
                    )}
                    {phase === 'uploaded' ? (
                        <p className="text-sm">Filen er sendt. Sammenligningen kører, når Zwift-resultatet er klar.</p>
                    ) : (
                        <button
                            type="button"
                            disabled={phase === 'uploading'}
                            onClick={() => void record.upload()}
                            className="w-full rounded-lg bg-primary py-3 font-bold text-primary-foreground disabled:opacity-50"
                        >
                            {phase === 'uploading' ? 'Sender…' : 'Upload'}
                        </button>
                    )}
                    <p className="text-sm text-muted-foreground">
                        Gik noget galt, kan du i stedet uploade en FIT-fil under verifikation.
                    </p>
                    <Link href="/verification" className="text-sm text-primary underline">Gå til verifikation</Link>
                </div>
            )}
        </div>
    );
}

function ConnectButton({ label, done, onClick }: { label: string; done: boolean; onClick: () => void }) {
    return (
        <button type="button" onClick={onClick} className="rounded-lg border border-border px-4 py-3 text-left font-semibold">
            {done ? '✓ ' : ''}{label}
        </button>
    );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-semibold">{value}</span>
        </div>
    );
}
