'use client';

import { useEffect, useState, useCallback } from 'react';
import { db } from '@/lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { API_URL } from '@/lib/api';
import { User } from 'firebase/auth';
import type { Race, LoadingStatus, ResultsAutomationConfig } from '@/types/admin';
import ResultsModal from './ResultsModal';

interface ResultsTabProps {
    user: User | null;
    races: Race[];
    status: LoadingStatus;
    setStatus: (s: LoadingStatus) => void;
    refreshRace: (raceId: string) => Promise<void>;
}

const formatTimestamp = (value?: unknown) => {
    if (!value) return 'N/A';
    const maybeTs = value as { seconds?: unknown; nanoseconds?: unknown };
    if (typeof maybeTs?.seconds === 'number') {
        const millis =
            maybeTs.seconds * 1000 +
            (typeof maybeTs?.nanoseconds === 'number'
                ? Math.floor(maybeTs.nanoseconds / 1_000_000)
                : 0);
        const d = new Date(millis);
        if (!Number.isNaN(d.getTime())) return d.toLocaleString();
    }
    const d = new Date(String(value));
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
};

export default function ResultsTab({ user, races, status, setStatus, refreshRace }: ResultsTabProps) {
    const [viewingResultsId, setViewingResultsId] = useState<string | null>(null);
    const [liveResultsRunning, setLiveResultsRunning] = useState(false);
    const [finalizeResultsRunning, setFinalizeResultsRunning] = useState(false);
    const [resultsCalcStatus, setResultsCalcStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [drBatchRunning, setDrBatchRunning] = useState(false);
    const [drBatchStatus, setDrBatchStatus] = useState<{ type: 'info' | 'success' | 'error'; text: string } | null>(null);
    const [drBatchProgress, setDrBatchProgress] = useState<{
        total: number;
        completed: number;
        triggered: number;
        missingActivity: number;
        errors: number;
        currentLabel?: string;
        etaSec?: number;
    } | null>(null);
    const [categoryFilter, setCategoryFilter] = useState('All');
    const [automationConfig, setAutomationConfig] = useState<ResultsAutomationConfig>({
        automationEnabled: false,
        pollingIntervalMinutes: 5,
        windowStart: '',
        windowEnd: '',
        windowDurationMinutes: 180,
        finalizeDelayMinutes: 30,
    });

    // Real-time race updates via Firestore
    const { data: liveRaceData } = useFirestoreDoc<Race>('races', viewingResultsId);
    const viewingRace = viewingResultsId
        ? (liveRaceData ?? races.find(r => r.id === viewingResultsId) ?? null)
        : null;

    useEffect(() => {
        if (!viewingRace) return;
        const incoming = viewingRace.resultsAutomation || {};
        setAutomationConfig({
            automationEnabled: Boolean(incoming.automationEnabled),
            pollingIntervalMinutes: Number(incoming.pollingIntervalMinutes ?? 5),
            windowStart: String(incoming.windowStart ?? ''),
            windowEnd: String(incoming.windowEnd ?? ''),
            windowDurationMinutes: Number(incoming.windowDurationMinutes ?? 180),
            finalizeDelayMinutes: Number(incoming.finalizeDelayMinutes ?? 30),
        });
    }, [viewingRace?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleRaceUpdate = useCallback(
        (updatedRace: Race) => {
            // ResultsModal callback — race is updated via Firestore listener
            void updatedRace;
        },
        [],
    );

    const handleRefreshResults = async (
        raceId: string,
        phase: 'provisional' | 'finalized',
    ): Promise<{ ok: boolean; message: string }> => {
        if (!user) return { ok: false, message: 'Not authenticated' };
        const isFinalize = phase === 'finalized';
        const confirmText = isFinalize
            ? 'Finalize Results now? This marks current race results as finalized.'
            : 'Run Live Results now? This updates provisional sprint standings during the race.';
        if (!confirm(confirmText)) {
            return { ok: false, message: `${isFinalize ? 'Finalize' : 'Live'} action cancelled` };
        }

        setStatus('refreshing');
        try {
            const token = await user.getIdToken();
            const endpoint = isFinalize
                ? `${API_URL}/races/${raceId}/results/finalize`
                : `${API_URL}/races/${raceId}/results/refresh`;
            const bodyPayload = isFinalize
                ? { categoryFilter }
                : { source: 'finishers', categoryFilter, phase: 'provisional' };
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyPayload),
            });

            if (res.ok) {
                await refreshRace(raceId);
                return {
                    ok: true,
                    message: isFinalize
                        ? 'Race finalized successfully.'
                        : 'Live results updated successfully.',
                };
            } else {
                const data = await res.json();
                return {
                    ok: false,
                    message: `${isFinalize ? 'Finalize' : 'Live'} failed: ${data.message || 'Unknown error'}`,
                };
            }
        } catch {
            return { ok: false, message: `Error running ${phase} results` };
        } finally {
            setStatus('idle');
        }
    };

    const handleRunLiveResults = useCallback(async () => {
        if (!viewingResultsId || liveResultsRunning || finalizeResultsRunning) return;
        setResultsCalcStatus(null);
        setLiveResultsRunning(true);
        try {
            const result = await handleRefreshResults(viewingResultsId, 'provisional');
            setResultsCalcStatus({ type: result.ok ? 'success' : 'error', text: result.message });
        } catch {
            setResultsCalcStatus({ type: 'error', text: 'Failed to run live results.' });
        } finally {
            setLiveResultsRunning(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewingResultsId, liveResultsRunning, finalizeResultsRunning, categoryFilter]);

    const handleFinalizeSelectedRace = useCallback(async () => {
        if (!viewingResultsId || liveResultsRunning || finalizeResultsRunning) return;
        setResultsCalcStatus(null);
        setFinalizeResultsRunning(true);
        try {
            const result = await handleRefreshResults(viewingResultsId, 'finalized');
            setResultsCalcStatus({ type: result.ok ? 'success' : 'error', text: result.message });
        } catch {
            setResultsCalcStatus({ type: 'error', text: 'Failed to finalize results.' });
        } finally {
            setFinalizeResultsRunning(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewingResultsId, liveResultsRunning, finalizeResultsRunning, categoryFilter]);

    const handleSaveAutomation = useCallback(async () => {
        if (!viewingResultsId || !user) return;
        setStatus('saving');
        try {
            await updateDoc(doc(db, 'races', viewingResultsId), { resultsAutomation: automationConfig });
            await refreshRace(viewingResultsId);
            setResultsCalcStatus({ type: 'success', text: 'Automation settings saved.' });
        } catch {
            setResultsCalcStatus({ type: 'error', text: 'Failed to save automation settings.' });
        } finally {
            setStatus('idle');
        }
    }, [viewingResultsId, user, automationConfig, refreshRace, setStatus]);

    // Shared verification batch runner
    const runVerificationBatch = async (
        getToken: () => Promise<string>,
        drRiders: { zwiftId: string; name: string }[],
        swRiders: { zwiftId: string; name: string }[],
    ) => {
        const total = drRiders.length + swRiders.length;
        if (total <= 0) {
            setDrBatchStatus({ type: 'success', text: 'No riders to verify in this race.' });
            setDrBatchProgress({ total: 0, completed: 0, triggered: 0, missingActivity: 0, errors: 0, etaSec: 0 });
            return;
        }

        let completed = 0, triggered = 0, missingActivity = 0, errors = 0;
        const startedAt = Date.now();

        const updateProgress = (currentLabel?: string) => {
            let etaSec: number | undefined;
            if (completed > 0 && completed < total) {
                const elapsed = (Date.now() - startedAt) / 1000;
                etaSec = Math.max(0, Math.round((elapsed / completed) * (total - completed)));
            } else if (completed >= total) {
                etaSec = 0;
            }
            setDrBatchProgress({ total, completed, triggered, missingActivity, errors, currentLabel, etaSec });
            setDrBatchStatus({ type: 'info', text: `Verificerer: ${completed}/${total}` });
        };

        const fetchRider = async (url: string) => {
            const token = await getToken();
            const ctrl = new AbortController();
            const timeoutId = setTimeout(() => ctrl.abort(), 90_000);
            try {
                return await fetch(url, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({}),
                    signal: ctrl.signal,
                });
            } finally {
                clearTimeout(timeoutId);
            }
        };

        updateProgress();

        for (const rider of drRiders) {
            const zwiftId = String(rider?.zwiftId || '').trim();
            const label = String(rider?.name || zwiftId || 'Unknown rider');
            if (!zwiftId) { completed++; errors++; updateProgress(label); continue; }
            updateProgress(label);
            try {
                const res = await fetchRider(`${API_URL}/admin/races/${viewingResultsId}/verify-dual-recording/${zwiftId}`);
                const body = await res.json().catch(() => ({}));
                if (!res.ok) errors++;
                else {
                    const st = String(body?.verification?.status || '');
                    if (st === 'missing_activity') missingActivity++;
                    else if (st === 'error') errors++;
                    else triggered++;
                }
            } catch { errors++; }
            finally { completed++; updateProgress(label); }
        }

        for (const rider of swRiders) {
            const zwiftId = String(rider?.zwiftId || '').trim();
            const label = String(rider?.name || zwiftId || 'Unknown rider');
            if (!zwiftId) { completed++; errors++; updateProgress(label); continue; }
            updateProgress(label);
            try {
                const res = await fetchRider(`${API_URL}/admin/races/${viewingResultsId}/verify-sticky-watts/${zwiftId}`);
                const body = await res.json().catch(() => ({}));
                if (!res.ok) errors++;
                else {
                    const st = String(body?.verification?.status || '');
                    if (st === 'missing_activity') missingActivity++;
                    else triggered++;
                }
            } catch { errors++; }
            finally { completed++; updateProgress(label); }
        }

        setDrBatchProgress({ total, completed, triggered, missingActivity, errors, etaSec: 0 });
        setDrBatchStatus({
            type: errors > 0 ? 'error' : 'success',
            text: `Done: ${completed}/${total}. Triggered: ${triggered}, missing: ${missingActivity}, errors: ${errors}.`,
        });
    };

    const handleVerifyDRBatch = useCallback(async () => {
        if (!viewingResultsId || !user || drBatchRunning) return;
        setDrBatchRunning(true);
        setDrBatchProgress(null);
        setDrBatchStatus({ type: 'info', text: 'Henter kandidater...' });
        try {
            const token = await user.getIdToken();
            const [drRes, swRes] = await Promise.all([
                fetch(`${API_URL}/admin/races/${viewingResultsId}/verify-dual-recording/candidates`, { headers: { Authorization: `Bearer ${token}` } }),
                fetch(`${API_URL}/admin/races/${viewingResultsId}/verify-sticky-watts/candidates`, { headers: { Authorization: `Bearer ${token}` } }),
            ]);
            if (!drRes.ok) { setDrBatchStatus({ type: 'error', text: (await drRes.json().catch(() => ({}))).message || 'Could not load DR candidates' }); return; }
            if (!swRes.ok) { setDrBatchStatus({ type: 'error', text: (await swRes.json().catch(() => ({}))).message || 'Could not load SW candidates' }); return; }
            const drRiders: { zwiftId: string; name: string }[] = (await drRes.json()).riders ?? [];
            const swRiders: { zwiftId: string; name: string }[] = (await swRes.json()).riders ?? [];
            await runVerificationBatch(() => user.getIdToken(), drRiders, swRiders);
        } catch {
            setDrBatchStatus({ type: 'error', text: 'Network error while running verification batch.' });
        } finally {
            setDrBatchRunning(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewingResultsId, user, drBatchRunning]);

    const handleRunDROnly = useCallback(async () => {
        if (!viewingResultsId || !user || drBatchRunning) return;
        setDrBatchRunning(true);
        setDrBatchProgress(null);
        setDrBatchStatus({ type: 'info', text: 'Henter DR-kandidater...' });
        try {
            const token = await user.getIdToken();
            const res = await fetch(`${API_URL}/admin/races/${viewingResultsId}/verify-dual-recording/candidates`, { headers: { Authorization: `Bearer ${token}` } });
            if (!res.ok) { setDrBatchStatus({ type: 'error', text: (await res.json().catch(() => ({}))).message || 'Could not load DR candidates' }); return; }
            const drRiders: { zwiftId: string; name: string }[] = (await res.json()).riders ?? [];
            await runVerificationBatch(() => user.getIdToken(), drRiders, []);
        } catch {
            setDrBatchStatus({ type: 'error', text: 'Network error while running DR batch.' });
        } finally {
            setDrBatchRunning(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewingResultsId, user, drBatchRunning]);

    const handleRunSWOnly = useCallback(async () => {
        if (!viewingResultsId || !user || drBatchRunning) return;
        setDrBatchRunning(true);
        setDrBatchProgress(null);
        setDrBatchStatus({ type: 'info', text: 'Henter SW-kandidater...' });
        try {
            const token = await user.getIdToken();
            const headers = { Authorization: `Bearer ${token}` };
            const [drRes, swRes] = await Promise.all([
                fetch(`${API_URL}/admin/races/${viewingResultsId}/verify-dual-recording/candidates`, { headers }),
                fetch(`${API_URL}/admin/races/${viewingResultsId}/verify-sticky-watts/candidates`, { headers }),
            ]);
            if (!drRes.ok || !swRes.ok) { setDrBatchStatus({ type: 'error', text: 'Could not load SW candidates' }); return; }
            const drRiders: { zwiftId: string; name: string }[] = (await drRes.json()).riders ?? [];
            const swRiders: { zwiftId: string; name: string }[] = (await swRes.json()).riders ?? [];
            await runVerificationBatch(() => user.getIdToken(), [], [...drRiders, ...swRiders]);
        } catch {
            setDrBatchStatus({ type: 'error', text: 'Network error while running SW batch.' });
        } finally {
            setDrBatchRunning(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewingResultsId, user, drBatchRunning]);

    return (
        <div className="space-y-4">
            <div className="bg-card p-4 rounded-lg border border-border">
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-semibold text-foreground mb-2">Select race</label>
                        <select
                            value={viewingResultsId || ''}
                            onChange={(e) => {
                                setViewingResultsId(e.target.value || null);
                                setResultsCalcStatus(null);
                                setDrBatchStatus(null);
                                setDrBatchProgress(null);
                            }}
                            className="w-full p-2.5 border border-input rounded bg-background text-foreground"
                        >
                            <option value="">Choose a race...</option>
                            {races.map(r => (
                                <option key={r.id} value={r.id}>{r.date} - {r.name}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-foreground mb-2">Results controls</label>
                        <div className="space-y-3 p-3 bg-muted/30 rounded-lg border border-border/50">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Category</label>
                                    <select
                                        value={categoryFilter}
                                        onChange={(e) => setCategoryFilter(e.target.value)}
                                        className="w-full bg-background border border-input rounded px-2 py-2 text-sm font-medium text-foreground focus:ring-1 focus:ring-primary"
                                    >
                                        {['All', 'A', 'B', 'C', 'D', 'E'].map(cat => (
                                            <option key={cat} value={cat}>{cat}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Current phase</label>
                                    <div className="w-full bg-background border border-input rounded px-2 py-2 text-sm font-medium text-foreground">
                                        {(viewingRace?.resultsPhase || 'N/A').toUpperCase()}
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-wrap gap-2">
                                <button
                                    onClick={handleRunLiveResults}
                                    disabled={!viewingResultsId || liveResultsRunning || finalizeResultsRunning}
                                    className="w-full sm:w-auto text-sm bg-blue-600 text-white px-4 py-2 rounded hover:opacity-90 font-semibold disabled:opacity-50"
                                >
                                    {liveResultsRunning ? 'Running Live Results...' : 'Live Results'}
                                </button>
                                <button
                                    onClick={handleFinalizeSelectedRace}
                                    disabled={!viewingResultsId || liveResultsRunning || finalizeResultsRunning}
                                    className="w-full sm:w-auto text-sm bg-emerald-600 text-white px-4 py-2 rounded hover:opacity-90 font-semibold disabled:opacity-50"
                                >
                                    {finalizeResultsRunning ? 'Finalizing...' : 'Finalize Results'}
                                </button>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                                <div>Last provisional update: <span className="font-medium">{formatTimestamp(viewingRace?.provisionalUpdatedAt)}</span></div>
                                <div>Finalized at: <span className="font-medium">{formatTimestamp(viewingRace?.finalizedAt)}</span></div>
                            </div>

                            <div className="space-y-2 pt-2 border-t border-border/40">
                                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Automation</p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                    <label className="flex items-center gap-2 text-xs">
                                        <input
                                            type="checkbox"
                                            checked={Boolean(automationConfig.automationEnabled)}
                                            onChange={(e) => setAutomationConfig(prev => ({ ...prev, automationEnabled: e.target.checked }))}
                                        />
                                        Enable automation
                                    </label>
                                    <label className="text-xs">
                                        Poll interval (minutes)
                                        <input
                                            type="number"
                                            min={1}
                                            value={automationConfig.pollingIntervalMinutes ?? 5}
                                            onChange={(e) => setAutomationConfig(prev => ({ ...prev, pollingIntervalMinutes: Number(e.target.value) }))}
                                            className="w-full mt-1 bg-background border border-input rounded px-2 py-1.5"
                                        />
                                    </label>
                                    <label className="text-xs">
                                        Window start (HH:mm)
                                        <input
                                            type="time"
                                            value={automationConfig.windowStart ?? ''}
                                            onChange={(e) => setAutomationConfig(prev => ({ ...prev, windowStart: e.target.value }))}
                                            className="w-full mt-1 bg-background border border-input rounded px-2 py-1.5"
                                        />
                                    </label>
                                    <label className="text-xs">
                                        Window end (HH:mm)
                                        <input
                                            type="time"
                                            value={automationConfig.windowEnd ?? ''}
                                            onChange={(e) => setAutomationConfig(prev => ({ ...prev, windowEnd: e.target.value }))}
                                            className="w-full mt-1 bg-background border border-input rounded px-2 py-1.5"
                                        />
                                    </label>
                                    <label className="text-xs">
                                        Window duration (minutes)
                                        <input
                                            type="number"
                                            min={1}
                                            value={automationConfig.windowDurationMinutes ?? 180}
                                            onChange={(e) => setAutomationConfig(prev => ({ ...prev, windowDurationMinutes: Number(e.target.value) }))}
                                            className="w-full mt-1 bg-background border border-input rounded px-2 py-1.5"
                                        />
                                    </label>
                                    <label className="text-xs">
                                        Finalize delay (minutes)
                                        <input
                                            type="number"
                                            min={0}
                                            value={automationConfig.finalizeDelayMinutes ?? 30}
                                            onChange={(e) => setAutomationConfig(prev => ({ ...prev, finalizeDelayMinutes: Number(e.target.value) }))}
                                            className="w-full mt-1 bg-background border border-input rounded px-2 py-1.5"
                                        />
                                    </label>
                                </div>
                                <button
                                    onClick={handleSaveAutomation}
                                    disabled={!viewingResultsId || status === 'saving'}
                                    className="w-full sm:w-auto text-sm bg-slate-700 text-white px-4 py-2 rounded hover:opacity-90 font-semibold disabled:opacity-50"
                                >
                                    {status === 'saving' ? 'Saving Automation...' : 'Save Automation'}
                                </button>
                                <p className="text-xs text-muted-foreground">
                                    Automation status: {automationConfig.automationEnabled ? 'Enabled' : 'Disabled'} (manual actions always available)
                                </p>
                            </div>

                            {resultsCalcStatus && (
                                <p className={`text-xs ${resultsCalcStatus.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                    {resultsCalcStatus.text}
                                </p>
                            )}
                        </div>
                    </div>

                    <label className="block text-sm font-semibold text-foreground mb-2">Verification</label>
                    <div className="space-y-3 p-3 bg-muted/30 rounded-lg border border-border/50">
                        <p className="text-sm text-muted-foreground">Run verification for all required riders in this race.</p>
                        <div className="flex flex-wrap gap-2">
                            <button onClick={handleVerifyDRBatch} disabled={!viewingResultsId || drBatchRunning} className="text-sm bg-blue-600 text-white px-4 py-2 rounded hover:opacity-90 font-semibold disabled:opacity-50">
                                {drBatchRunning ? 'Running...' : 'Run Verification'}
                            </button>
                            <button onClick={handleRunDROnly} disabled={!viewingResultsId || drBatchRunning} className="text-sm bg-slate-600 text-white px-4 py-2 rounded hover:opacity-90 font-semibold disabled:opacity-50">
                                Run DR
                            </button>
                            <button onClick={handleRunSWOnly} disabled={!viewingResultsId || drBatchRunning} className="text-sm bg-slate-600 text-white px-4 py-2 rounded hover:opacity-90 font-semibold disabled:opacity-50">
                                Run SW
                            </button>
                        </div>
                        {drBatchProgress && drBatchProgress.total > 0 && (
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <div className="h-2 w-40 rounded-full bg-muted overflow-hidden">
                                    <div className="h-full bg-blue-500 transition-all" style={{ width: `${Math.min(100, (drBatchProgress.completed / drBatchProgress.total) * 100)}%` }} />
                                </div>
                                <span className="font-mono">{drBatchProgress.completed}/{drBatchProgress.total}</span>
                                {drBatchRunning && drBatchProgress.etaSec != null && (
                                    <span className="font-mono">ETA {Math.floor(drBatchProgress.etaSec / 60)}:{String(drBatchProgress.etaSec % 60).padStart(2, '0')}</span>
                                )}
                                {drBatchRunning && drBatchProgress.currentLabel && (
                                    <span className="truncate max-w-[180px]" title={drBatchProgress.currentLabel}>{drBatchProgress.currentLabel}</span>
                                )}
                            </div>
                        )}
                        {drBatchStatus && (
                            <p className={`text-xs ${drBatchStatus.type === 'success' ? 'text-green-600 dark:text-green-400' : drBatchStatus.type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>
                                {drBatchStatus.text}
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {viewingRace ? (
                <ResultsModal
                    race={viewingRace}
                    status={status}
                    onClose={() => setViewingResultsId(null)}
                    onRaceUpdate={handleRaceUpdate}
                    embedded
                />
            ) : (
                <div className="bg-card p-8 rounded-lg border border-border text-center text-muted-foreground">
                    Choose a race to manage results, DR, DQ/DC/EX.
                </div>
            )}
        </div>
    );
}
