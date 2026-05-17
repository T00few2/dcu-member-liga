'use client';

import { useEffect, useState, useCallback } from 'react';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';

// Hooks
import { useRaceForm } from '@/hooks/useRaceForm';
import { useLeagueData } from '@/hooks/useLeagueData';

// Types
import type { Race, Segment, Route, LeagueSettings, LoadingStatus, ResultsAutomationConfig } from '@/types/admin';

// Sub-components
import {
    RaceForm,
    RaceList,
    ResultsModal,
    LeagueSettingsForm,
    TestDataPanel,
    RawDataViewer,
} from './league-manager';

export type LeagueManagerTab = 'races' | 'results' | 'settings' | 'testing' | 'rawdata';

interface LeagueManagerProps {
    initialActiveTab?: LeagueManagerTab;
    onTabChange?: (tab: LeagueManagerTab) => void;
}

const LEAGUE_MANAGER_TABS: LeagueManagerTab[] = ['races', 'results', 'settings', 'testing', 'rawdata'];

export default function LeagueManager({
    initialActiveTab = 'races',
    onTabChange,
}: LeagueManagerProps) {
    const { user, loading: authLoading } = useAuth();
    
    // Data from custom hooks
    const { 
        routes, 
        races, 
        leagueSettings, 
        status, 
        error,
        setRaces,
        setLeagueSettings,
        setStatus,
        fetchSegments,
        refreshRace,
    } = useLeagueData({ user, authLoading });

    const raceForm = useRaceForm();

    // Local UI state
    const [activeTab, setActiveTab] = useState<LeagueManagerTab>(() =>
        LEAGUE_MANAGER_TABS.includes(initialActiveTab) ? initialActiveTab : 'races'
    );
    const [archiveName, setArchiveName] = useState('');
    const [archiving, setArchiving] = useState(false);
    const [resetting, setResetting] = useState(false);
    const [viewingResultsId, setViewingResultsId] = useState<string | null>(null);
    const [availableSegments, setAvailableSegments] = useState<Segment[]>([]);
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

    useEffect(() => {
        if (LEAGUE_MANAGER_TABS.includes(initialActiveTab) && initialActiveTab !== activeTab) {
            setActiveTab(initialActiveTab);
        }
    }, [initialActiveTab, activeTab]);

    const eventConfigurationLapSignature = raceForm.formState.eventConfiguration
        .map(cfg => cfg.laps || 0)
        .join(',');
    const singleModeCategoryLapSignature = raceForm.formState.singleModeCategories
        .map(cat => cat.laps || 0)
        .join(',');
    const raceGroupLapSignature = raceForm.formState.raceGroups
        .map(g => g.laps || 0)
        .join(',');

    // Fetch segments when route or laps change
    useEffect(() => {
        const loadSegments = async () => {
            if (!raceForm.formState.selectedRouteId) {
                setAvailableSegments([]);
                return;
            }
            
            // Determine max laps across all configurations
            let maxLaps = raceForm.formState.laps;
            
            if (raceForm.formState.eventMode === 'multi' && raceForm.formState.eventConfiguration.length > 0) {
                const cfgMax = Math.max(...raceForm.formState.eventConfiguration.map(c => c.laps || 0));
                if (cfgMax > maxLaps) maxLaps = cfgMax;
            }

            if (raceForm.formState.eventMode === 'single' && raceForm.formState.singleModeCategories.length > 0) {
                const catMax = Math.max(...raceForm.formState.singleModeCategories.map(c => c.laps || 0));
                if (catMax > maxLaps) maxLaps = catMax;
            }

            if (raceForm.formState.eventMode === 'grouped' && raceForm.formState.raceGroups.length > 0) {
                const groupMax = Math.max(...raceForm.formState.raceGroups.map(g => g.laps || 0));
                if (groupMax > maxLaps) maxLaps = groupMax;
            }

            const segments = await fetchSegments(raceForm.formState.selectedRouteId, maxLaps);
            setAvailableSegments(segments);
        };

        loadSegments();
    }, [
        raceForm.formState.selectedRouteId,
        raceForm.formState.laps,
        raceForm.formState.eventMode,
        eventConfigurationLapSignature,
        singleModeCategoryLapSignature,
        raceGroupLapSignature,
        fetchSegments,
    ]);

    // Real-time listener for viewing results
    useEffect(() => {
        if (!viewingResultsId) return;

        const unsubscribe = onSnapshot(
            doc(db, 'races', viewingResultsId), 
            (docSnapshot) => {
                if (docSnapshot.exists()) {
                    const updatedData = docSnapshot.data();
                    setRaces(prev => prev.map(r => 
                        r.id === viewingResultsId ? { ...r, ...updatedData } as Race : r
                    ));
                }
            }, 
            (error) => {
                console.error("Error listening to race updates:", error);
            }
        );

        return () => unsubscribe();
    }, [viewingResultsId, setRaces]);

    const viewingRace = viewingResultsId ? races.find(r => r.id === viewingResultsId) || null : null;

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
    }, [viewingRace]);

    // Handlers
    const handleEdit = useCallback((race: Race) => {
        raceForm.loadRace(race);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [raceForm]);

    const handleCancel = useCallback(() => {
        raceForm.resetForm();
    }, [raceForm]);

    const handleSaveRace = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;
        
        const selectedRoute = routes.find(r => r.id === raceForm.formState.selectedRouteId);
        if (!selectedRoute) return;
        
        setStatus('saving');
        try {
            const token = await user.getIdToken();
            const { formState } = raceForm;
            
            const calcDistance = (selectedRoute.distance * formState.laps + selectedRoute.leadinDistance).toFixed(1);
            const calcElevation = Math.round(selectedRoute.elevation * formState.laps + selectedRoute.leadinElevation);

            const raceData: Partial<Race> = {
                name: formState.name,
                date: formState.date,
                type: formState.raceType,
                routeId: selectedRoute.id,
                routeName: selectedRoute.name,
                map: selectedRoute.map,
                laps: formState.laps,
                totalDistance: Number(calcDistance),
                totalElevation: Number(calcElevation),
                selectedSegments: formState.selectedSprints.map(s => s.key),
                sprints: formState.selectedSprints,
                segmentType: formState.segmentType,
                eventMode: formState.eventMode,
            };

            if (formState.eventMode === 'single') {
                raceData.eventId = formState.eventId;
                raceData.eventSecret = formState.eventSecret;
                raceData.eventConfiguration = [];
                raceData.singleModeCategories = formState.singleModeCategories.length > 0
                    ? formState.singleModeCategories
                    : [];
                raceData.raceGroups = [];
                raceData.linkedEventIds = formState.eventId ? [formState.eventId] : [];
            } else if (formState.eventMode === 'grouped') {
                raceData.raceGroups = formState.raceGroups;
                raceData.eventConfiguration = [];
                raceData.singleModeCategories = [];
                raceData.eventId = '';
                raceData.eventSecret = '';
                raceData.linkedEventIds = [
                    ...new Set(formState.raceGroups.map(g => g.eventId).filter(Boolean)),
                ];
            } else {
                raceData.eventConfiguration = formState.eventConfiguration;
                raceData.singleModeCategories = [];
                raceData.raceGroups = [];
                raceData.eventId = '';
                raceData.eventSecret = '';
                raceData.linkedEventIds = formState.eventConfiguration
                    .map(c => c.eventId)
                    .filter(Boolean);
            }
            
            const method = formState.editingRaceId ? 'PUT' : 'POST';
            const url = formState.editingRaceId 
                ? `${API_URL}/races/${formState.editingRaceId}` 
                : `${API_URL}/races`;

            const res = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify(raceData),
            });
            
            if (res.ok) {
                const data = await res.json();
                const savedRace = (data.race || { ...raceData, id: formState.editingRaceId || data.id }) as Race;
                
                if (formState.editingRaceId) {
                    setRaces(races.map(r => r.id === formState.editingRaceId ? savedRace : r));
                } else {
                    setRaces([...races, savedRace]);
                }
                if (Array.isArray(data.warnings) && data.warnings.length > 0) {
                    alert(`Race saved with warnings:\n- ${data.warnings.join('\n- ')}`);
                }
                raceForm.resetForm();
            } else {
                const err = await res.json();
                alert(`Error: ${err.message}`);
            }
        } catch (e) {
            alert('Failed to save race');
        } finally {
            setStatus('idle');
        }
    };

    const handleDeleteRace = async (id: string) => {
        if (!user || !confirm('Delete this race?')) return;
        try {
            const token = await user.getIdToken();
            await fetch(`${API_URL}/races/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` },
            });
            setRaces(races.filter(r => r.id !== id));
        } catch (e) {
            alert('Failed to delete');
        }
    };

    const handleRefreshResults = async (
        raceId: string,
        phase: 'provisional' | 'finalized',
    ): Promise<{ ok: boolean; message: string }> => {
        if (!user) return { ok: false, message: 'Not authenticated' };
        const isFinalize = phase === 'finalized';
        const confirmationText = isFinalize
            ? 'Finalize Results now? This marks current race results as finalized.'
            : 'Run Live Results now? This updates provisional sprint standings during the race.';
        if (!confirm(confirmationText)) {
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
                : {
                    source: 'finishers',
                    categoryFilter,
                    phase: 'provisional',
                };
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(bodyPayload),
            });
            
            if (res.ok) {
                // Refresh local state from Firebase
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
        } catch (e) {
            return { ok: false, message: `Error running ${phase} results` };
        } finally {
            setStatus('idle');
        }
    };

    const handleRaceUpdate = useCallback((updatedRace: Race) => {
        setRaces(prev => prev.map(r => r.id === updatedRace.id ? updatedRace : r));
    }, [setRaces]);

    const handleRunLiveResults = useCallback(async () => {
        if (!viewingResultsId || liveResultsRunning || finalizeResultsRunning) return;
        setResultsCalcStatus(null);
        setLiveResultsRunning(true);
        try {
            const result = await handleRefreshResults(viewingResultsId, 'provisional');
            setResultsCalcStatus({
                type: result.ok ? 'success' : 'error',
                text: result.message,
            });
        } catch {
            setResultsCalcStatus({
                type: 'error',
                text: 'Failed to run live results.',
            });
        } finally {
            setLiveResultsRunning(false);
        }
    }, [viewingResultsId, liveResultsRunning, finalizeResultsRunning]);

    const handleFinalizeSelectedRace = useCallback(async () => {
        if (!viewingResultsId || liveResultsRunning || finalizeResultsRunning) return;
        setResultsCalcStatus(null);
        setFinalizeResultsRunning(true);
        try {
            const result = await handleRefreshResults(viewingResultsId, 'finalized');
            setResultsCalcStatus({
                type: result.ok ? 'success' : 'error',
                text: result.message,
            });
        } catch {
            setResultsCalcStatus({
                type: 'error',
                text: 'Failed to finalize results.',
            });
        } finally {
            setFinalizeResultsRunning(false);
        }
    }, [viewingResultsId, liveResultsRunning, finalizeResultsRunning]);

    const handleSaveAutomation = useCallback(async () => {
        if (!viewingResultsId || !user) return;
        setStatus('saving');
        try {
            const raceRef = doc(db, 'races', viewingResultsId);
            await updateDoc(raceRef, { resultsAutomation: automationConfig });
            await refreshRace(viewingResultsId);
            setResultsCalcStatus({ type: 'success', text: 'Automation settings saved.' });
        } catch {
            setResultsCalcStatus({ type: 'error', text: 'Failed to save automation settings.' });
        } finally {
            setStatus('idle');
        }
    }, [viewingResultsId, user, automationConfig, refreshRace, setStatus]);

    const handleVerifyDRBatch = useCallback(async () => {
        if (!viewingResultsId || !user || drBatchRunning) return;
        setDrBatchRunning(true);
        setDrBatchProgress(null);
        setDrBatchStatus({ type: 'info', text: 'Henter kandidater...' });

        try {
            const token = await user.getIdToken();

            // Fetch DR candidates and SW-only candidates in parallel.
            const [drRes, swRes] = await Promise.all([
                fetch(`${API_URL}/admin/races/${viewingResultsId}/verify-dual-recording/candidates`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
                fetch(`${API_URL}/admin/races/${viewingResultsId}/verify-sticky-watts/candidates`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            ]);

            if (!drRes.ok) {
                const body = await drRes.json().catch(() => ({}));
                setDrBatchStatus({ type: 'error', text: body.message || 'Could not load DR candidates' });
                return;
            }
            if (!swRes.ok) {
                const body = await swRes.json().catch(() => ({}));
                setDrBatchStatus({ type: 'error', text: body.message || 'Could not load SW candidates' });
                return;
            }

            const drBody = await drRes.json();
            const swBody = await swRes.json();
            const drRiders: { zwiftId: string; name: string }[] = Array.isArray(drBody.riders) ? drBody.riders : [];
            const swRiders: { zwiftId: string; name: string }[] = Array.isArray(swBody.riders) ? swBody.riders : [];
            const total = drRiders.length + swRiders.length;

            if (total <= 0) {
                setDrBatchStatus({ type: 'success', text: 'No riders to verify in this race.' });
                setDrBatchProgress({ total: 0, completed: 0, triggered: 0, missingActivity: 0, errors: 0, etaSec: 0 });
                return;
            }

            let completed = 0;
            let triggered = 0;
            let missingActivity = 0;
            let errors = 0;
            const startedAt = Date.now();

            const updateProgress = (currentLabel?: string) => {
                let etaSec: number | undefined;
                if (completed > 0 && completed < total) {
                    const elapsedSec = (Date.now() - startedAt) / 1000;
                    const avgSecPerRider = elapsedSec / completed;
                    etaSec = Math.max(0, Math.round(avgSecPerRider * (total - completed)));
                } else if (completed >= total) {
                    etaSec = 0;
                }
                setDrBatchProgress({ total, completed, triggered, missingActivity, errors, currentLabel, etaSec });
                setDrBatchStatus({ type: 'info', text: `Verificerer: ${completed}/${total}` });
            };

            updateProgress();

            // Process DR riders first (full DR + SW).
            for (const rider of drRiders) {
                const zwiftId = String(rider?.zwiftId || '').trim();
                const currentLabel = String(rider?.name || zwiftId || 'Unknown rider');
                if (!zwiftId) { completed += 1; errors += 1; updateProgress(currentLabel); continue; }
                updateProgress(currentLabel);
                try {
                    const res = await fetch(
                        `${API_URL}/admin/races/${viewingResultsId}/verify-dual-recording/${zwiftId}`,
                        { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
                    );
                    const body = await res.json();
                    if (!res.ok) { errors += 1; }
                    else {
                        const status = String(body?.verification?.status || '');
                        if (status === 'missing_activity') missingActivity += 1;
                        else if (status === 'error') errors += 1;
                        else triggered += 1;
                    }
                } catch { errors += 1; }
                finally { completed += 1; updateProgress(currentLabel); }
            }

            // Process SW-only riders.
            for (const rider of swRiders) {
                const zwiftId = String(rider?.zwiftId || '').trim();
                const currentLabel = String(rider?.name || zwiftId || 'Unknown rider');
                if (!zwiftId) { completed += 1; errors += 1; updateProgress(currentLabel); continue; }
                updateProgress(currentLabel);
                try {
                    const res = await fetch(
                        `${API_URL}/admin/races/${viewingResultsId}/verify-sticky-watts/${zwiftId}`,
                        { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
                    );
                    if (!res.ok) { errors += 1; }
                    else {
                        const body = await res.json().catch(() => ({}));
                        const status = String(body?.verification?.status || '');
                        if (status === 'missing_activity') missingActivity += 1;
                        else triggered += 1;
                    }
                } catch { errors += 1; }
                finally { completed += 1; updateProgress(currentLabel); }
            }

            setDrBatchProgress({ total, completed, triggered, missingActivity, errors, etaSec: 0 });
            setDrBatchStatus({
                type: errors > 0 ? 'error' : 'success',
                text: `Done: ${completed}/${total}. Triggered: ${triggered}, missing_activity: ${missingActivity}, errors: ${errors}.`,
            });
        } catch {
            setDrBatchStatus({ type: 'error', text: 'Network error while running verification batch.' });
        } finally {
            setDrBatchRunning(false);
        }
    }, [viewingResultsId, user, drBatchRunning]);

    const handleSetActiveTab = useCallback((tab: LeagueManagerTab) => {
        setActiveTab(tab);
        onTabChange?.(tab);
    }, [onTabChange]);

    // Loading state
    if (authLoading || status === 'loading') {
        return <div className="p-8 text-center">Loading...</div>;
    }

    const formatTimestamp = (value?: unknown) => {
        if (!value) return 'N/A';
        const maybeTs = value as { seconds?: unknown; nanoseconds?: unknown };
        if (typeof maybeTs?.seconds === 'number') {
            const millis = maybeTs.seconds * 1000
                + (typeof maybeTs?.nanoseconds === 'number' ? Math.floor(maybeTs.nanoseconds / 1_000_000) : 0);
            const tsDate = new Date(millis);
            if (!Number.isNaN(tsDate.getTime())) return tsDate.toLocaleString();
        }

        const date = new Date(String(value));
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleString();
    };

    return (
        <div>
            {/* Tab Navigation */}
            <div className="flex gap-4 mb-8 border-b border-border">
                <button 
                    onClick={() => handleSetActiveTab('races')}
                    className={`pb-2 px-4 font-medium transition ${
                        activeTab === 'races' 
                            ? 'text-primary border-b-2 border-primary' 
                            : 'text-muted-foreground hover:text-foreground'
                    }`}
                >
                    Races
                </button>
                <button 
                    onClick={() => handleSetActiveTab('results')}
                    className={`pb-2 px-4 font-medium transition ${
                        activeTab === 'results' 
                            ? 'text-primary border-b-2 border-primary' 
                            : 'text-muted-foreground hover:text-foreground'
                    }`}
                >
                    Results
                </button>
                <button 
                    onClick={() => handleSetActiveTab('settings')}
                    className={`pb-2 px-4 font-medium transition ${
                        activeTab === 'settings' 
                            ? 'text-primary border-b-2 border-primary' 
                            : 'text-muted-foreground hover:text-foreground'
                    }`}
                >
                    Scoring Settings
                </button>
                <button 
                    onClick={() => handleSetActiveTab('testing')}
                    className={`pb-2 px-4 font-medium transition ${
                        activeTab === 'testing' 
                            ? 'text-primary border-b-2 border-primary' 
                            : 'text-muted-foreground hover:text-foreground'
                    }`}
                >
                    Testing
                </button>
                <button 
                    onClick={() => handleSetActiveTab('rawdata')}
                    className={`pb-2 px-4 font-medium transition ${
                        activeTab === 'rawdata' 
                            ? 'text-primary border-b-2 border-primary' 
                            : 'text-muted-foreground hover:text-foreground'
                    }`}
                >
                    Results Editor
                </button>
            </div>

            {/* Settings Tab */}
            {activeTab === 'results' && (
                <div className="space-y-4">
                    <div className="bg-card p-4 rounded-lg border border-border">
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-semibold text-foreground mb-2">
                                    Select race
                                </label>
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
                                        <option key={r.id} value={r.id}>
                                            {r.date} - {r.name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-foreground mb-2">
                                    Results controls
                                </label>
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
                                        <p className={`text-xs ${
                                            resultsCalcStatus.type === 'success'
                                                ? 'text-green-600 dark:text-green-400'
                                                : 'text-red-600 dark:text-red-400'
                                        }`}>
                                            {resultsCalcStatus.text}
                                        </p>
                                    )}
                                </div>
                            </div>

                            <label className="block text-sm font-semibold text-foreground mb-2">
                                Verification
                            </label>
                            <div className="space-y-3 p-3 bg-muted/30 rounded-lg border border-border/50">
                                <p className="text-sm text-muted-foreground">
                                    Run verification for all required riders in this race.
                                </p>
                                <button
                                    onClick={handleVerifyDRBatch}
                                    disabled={!viewingResultsId || drBatchRunning}
                                    className="w-full sm:w-auto text-sm bg-blue-600 text-white px-4 py-2 rounded hover:opacity-90 font-semibold disabled:opacity-50"
                                >
                                    {drBatchRunning ? 'Running Verification...' : 'Run Verification'}
                                </button>
                                {drBatchProgress && drBatchProgress.total > 0 && (
                                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                        <div className="h-2 w-40 rounded-full bg-muted overflow-hidden">
                                            <div
                                                className="h-full bg-blue-500 transition-all"
                                                style={{ width: `${Math.min(100, (drBatchProgress.completed / drBatchProgress.total) * 100)}%` }}
                                            />
                                        </div>
                                        <span className="font-mono">{drBatchProgress.completed}/{drBatchProgress.total}</span>
                                        {drBatchRunning && drBatchProgress.etaSec != null && (
                                            <span className="font-mono">
                                                ETA {Math.floor(drBatchProgress.etaSec / 60)}:{String(drBatchProgress.etaSec % 60).padStart(2, '0')}
                                            </span>
                                        )}
                                        {drBatchRunning && drBatchProgress.currentLabel && (
                                            <span className="truncate max-w-[180px]" title={drBatchProgress.currentLabel}>
                                                {drBatchProgress.currentLabel}
                                            </span>
                                        )}
                                    </div>
                                )}
                                {drBatchStatus && (
                                    <p className={`text-xs ${
                                        drBatchStatus.type === 'success'
                                            ? 'text-green-600 dark:text-green-400'
                                            : drBatchStatus.type === 'error'
                                                ? 'text-red-600 dark:text-red-400'
                                                : 'text-muted-foreground'
                                    }`}>
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
            )}

            {/* Settings Tab */}
            {activeTab === 'settings' && (
                <LeagueSettingsForm
                    user={user}
                    settings={leagueSettings}
                    onSave={setLeagueSettings}
                    status={status}
                    setStatus={setStatus}
                />
            )}

            {/* Testing Tab */}
            {activeTab === 'testing' && (
                <TestDataPanel
                    user={user}
                    races={races}
                    status={status}
                    setStatus={setStatus}
                />
            )}

            {/* Raw Data Tab */}
            {activeTab === 'rawdata' && (
                <RawDataViewer races={races} onRaceUpdate={handleRaceUpdate} />
            )}

            {/* Races Tab */}
            {activeTab === 'races' && (
                <>
                    {/* League Name Configuration */}
                    <div className="bg-card p-6 rounded-lg shadow mb-8 border border-border">
                        <h2 className="text-xl font-semibold mb-4 text-card-foreground">League Configuration</h2>
                        <div className="flex gap-4 items-end">
                            <div className="flex-1">
                                <label className="block text-sm font-medium text-muted-foreground mb-1">
                                    League Name
                                </label>
                                <input 
                                    type="text"
                                    value={leagueSettings.name || ''}
                                    onChange={e => setLeagueSettings({ ...leagueSettings, name: e.target.value })}
                                    className="w-full p-2 border border-input rounded bg-background text-foreground"
                                    placeholder="e.g. DCU e-Cycling Cup 2026"
                                />
                            </div>
                            <button 
                                onClick={async () => {
                                    if (!user) return;
                                    setStatus('saving');
                                    try {
                                        const token = await user.getIdToken();
                                        await fetch(`${API_URL}/league/settings`, {
                                            method: 'POST',
                                            headers: {
                                                'Content-Type': 'application/json',
                                                'Authorization': `Bearer ${token}`,
                                            },
                                            body: JSON.stringify(leagueSettings),
                                        });
                                        alert('Name saved!');
                                    } catch {
                                        alert('Failed to save');
                                    } finally {
                                        setStatus('idle');
                                    }
                                }}
                                disabled={status === 'saving'}
                                className="bg-primary text-primary-foreground px-4 py-2 rounded hover:opacity-90 font-medium"
                            >
                                {status === 'saving' ? 'Saving...' : 'Save Name'}
                            </button>
                        </div>
                    </div>

                    {/* Race Form */}
                    <RaceForm
                        user={user}
                        routes={routes}
                        segments={availableSegments}
                        formState={raceForm.formState}
                        status={status}
                        onFieldChange={raceForm.updateField}
                        onToggleSegment={raceForm.toggleSegment}
                        onAddEventConfig={raceForm.addEventConfig}
                        onRemoveEventConfig={raceForm.removeEventConfig}
                        onUpdateEventConfig={raceForm.updateEventConfig}
                        onToggleConfigSprint={raceForm.toggleConfigSprint}
                        onAddSingleModeCategory={raceForm.addSingleModeCategory}
                        onRemoveSingleModeCategory={raceForm.removeSingleModeCategory}
                        onUpdateSingleModeCategory={raceForm.updateSingleModeCategory}
                        onToggleSingleModeCategorySprint={raceForm.toggleSingleModeCategorySprint}
                        onAddRaceGroup={raceForm.addRaceGroup}
                        onRemoveRaceGroup={raceForm.removeRaceGroup}
                        onUpdateRaceGroup={raceForm.updateRaceGroup}
                        onAddGroupCategory={raceForm.addGroupCategory}
                        onRemoveGroupCategory={raceForm.removeGroupCategory}
                        onUpdateGroupCategory={raceForm.updateGroupCategory}
                        onToggleGroupCategorySprint={raceForm.toggleGroupCategorySprint}
                        onToggleGroupSprint={raceForm.toggleGroupSprint}
                        onCancel={handleCancel}
                        onSave={handleSaveRace}
                    />

                    {/* Results Modal */}
                    {/* Race List */}
                    <RaceList
                        races={races}
                        leagueSettings={leagueSettings}
                        editingRaceId={raceForm.formState.editingRaceId}
                        status={status}
                        onEdit={handleEdit}
                        onDelete={handleDeleteRace}
                    />

                    {/* Season management */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
                        {/* Archive */}
                        <div className="bg-card p-6 rounded-lg shadow border border-border flex flex-col">
                            <h2 className="text-lg font-semibold mb-1 text-card-foreground">Arkivér sæson</h2>
                            <p className="text-sm text-muted-foreground mb-4">
                                Gem et snapshot af den aktuelle sæsons løb, stilling og indstillinger til historikken. De aktuelle data berøres ikke.
                            </p>
                            <div className="space-y-3 flex-1 flex flex-col">
                                <div>
                                    <label className="block text-sm font-medium text-muted-foreground mb-1">Sæsonnavn</label>
                                    <input
                                        type="text"
                                        value={archiveName}
                                        onChange={e => setArchiveName(e.target.value)}
                                        placeholder={`${leagueSettings.name || 'Forårsliga'} ${new Date().getFullYear()}`}
                                        className="w-full p-2 border border-input rounded bg-background text-foreground text-sm"
                                    />
                                </div>
                                <button
                                    disabled={archiving}
                                    onClick={async () => {
                                        const name = archiveName.trim() || `${leagueSettings.name || 'Forårsliga'} ${new Date().getFullYear()}`;
                                        if (!confirm(`Arkivér sæson som "${name}"?\n\nDette kopierer alle løb og stillingen til historikken. Aktuelle data slettes ikke.`)) return;
                                        setArchiving(true);
                                        try {
                                            const token = await user?.getIdToken();
                                            const res = await fetch(`${API_URL}/admin/archive-season`, {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                                                body: JSON.stringify({ name }),
                                            });
                                            const data = await res.json();
                                            if (res.ok) {
                                                alert(`Sæson arkiveret! ${data.raceCount} løb gemt under "${name}".`);
                                                setArchiveName('');
                                            } else {
                                                alert(`Fejl: ${data.message}`);
                                            }
                                        } catch {
                                            alert('Arkivering fejlede');
                                        } finally {
                                            setArchiving(false);
                                        }
                                    }}
                                    className="w-full mt-auto px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 font-medium text-sm"
                                >
                                    {archiving ? 'Arkiverer…' : 'Arkivér sæson'}
                                </button>
                            </div>
                        </div>

                        {/* Reset */}
                        <div className="bg-card p-6 rounded-lg shadow border border-red-200 dark:border-red-900 flex flex-col">
                            <h2 className="text-lg font-semibold mb-1 text-red-700 dark:text-red-400">Nulstil sæson</h2>
                            <p className="text-sm text-muted-foreground mb-4">
                                Sletter alle løb og nulstiller stillingen. Scoring-indstillinger og kategoriopsætning bevares. <strong className="text-red-600 dark:text-red-400">Kan ikke fortrydes.</strong>
                            </p>
                            <button
                                disabled={resetting}
                                onClick={async () => {
                                    if (!confirm('ADVARSEL: Dette sletter alle løb og nulstiller stillingen permanent.\n\nHar du arkiveret sæsonen først?\n\nFortsæt?')) return;
                                    if (!confirm('Er du helt sikker? Alle løbsdata slettes permanent.')) return;
                                    setResetting(true);
                                    try {
                                        const token = await user?.getIdToken();
                                        const res = await fetch(`${API_URL}/admin/reset-season`, {
                                            method: 'POST',
                                            headers: { 'Authorization': `Bearer ${token}` },
                                        });
                                        const data = await res.json();
                                        if (res.ok) {
                                            alert(`Sæson nulstillet. ${data.racesDeleted} løb slettet.`);
                                            setRaces([]);
                                        } else {
                                            alert(`Fejl: ${data.message}`);
                                        }
                                    } catch {
                                        alert('Nulstilling fejlede');
                                    } finally {
                                        setResetting(false);
                                    }
                                }}
                                className="w-full mt-auto px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 font-medium text-sm"
                            >
                                {resetting ? 'Nulstiller…' : 'Nulstil sæson'}
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
