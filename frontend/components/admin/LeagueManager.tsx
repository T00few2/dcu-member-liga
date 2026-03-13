'use client';

import { useEffect, useState, useCallback } from 'react';
import { db } from '@/lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';

// Hooks
import { useRaceForm } from '@/hooks/useRaceForm';
import { useLeagueData } from '@/hooks/useLeagueData';

// Types
import type { Race, Segment, Route, LeagueSettings, LoadingStatus, ResultSource } from '@/types/admin';

// Sub-components
import {
    RaceForm,
    RaceList,
    ResultsModal,
    LeagueSettingsForm,
    TestDataPanel,
    RawDataViewer,
} from './league-manager';

export default function LeagueManager() {
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
    const [activeTab, setActiveTab] = useState<'races' | 'settings' | 'testing' | 'rawdata'>('races');
    const [archiveName, setArchiveName] = useState('');
    const [archiving, setArchiving] = useState(false);
    const [resetting, setResetting] = useState(false);
    const [viewingResultsId, setViewingResultsId] = useState<string | null>(null);
    const [availableSegments, setAvailableSegments] = useState<Segment[]>([]);
    
    // Results fetch options
    const [resultSource, setResultSource] = useState<ResultSource>('finishers');
    const [filterRegistered, setFilterRegistered] = useState(false);
    const [categoryFilter, setCategoryFilter] = useState('All');

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

            const segments = await fetchSegments(raceForm.formState.selectedRouteId, maxLaps);
            setAvailableSegments(segments);
        };

        loadSegments();
    }, [
        raceForm.formState.selectedRouteId, 
        raceForm.formState.laps, 
        raceForm.formState.eventMode,
        raceForm.formState.eventConfiguration.length,
        raceForm.formState.singleModeCategories.length,
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
                profileSegments: [...(formState.profileSegments || [])]
                    .map((s) => ({
                        ...s,
                        fromKm: Number(s.fromKm) || 0,
                        toKm: Number(s.toKm) || 0,
                    })),
                eventMode: formState.eventMode,
            };

            if (formState.eventMode === 'single') {
                raceData.eventId = formState.eventId;
                raceData.eventSecret = formState.eventSecret;
                raceData.eventConfiguration = [];
                raceData.singleModeCategories = formState.singleModeCategories.length > 0 
                    ? formState.singleModeCategories 
                    : [];
                raceData.linkedEventIds = formState.eventId ? [formState.eventId] : [];
            } else {
                raceData.eventConfiguration = formState.eventConfiguration;
                raceData.singleModeCategories = [];
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
                const savedRace = { ...raceData, id: formState.editingRaceId || data.id } as Race;
                
                if (formState.editingRaceId) {
                    setRaces(races.map(r => r.id === formState.editingRaceId ? savedRace : r));
                } else {
                    setRaces([...races, savedRace]);
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

    const handleRefreshResults = async (raceId: string) => {
        if (!user) return;
        if (!confirm('Calculate results? This may take a few seconds.')) return;
        
        setStatus('refreshing');
        try {
            const token = await user.getIdToken();
            const res = await fetch(`${API_URL}/races/${raceId}/results/refresh`, {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    source: resultSource,
                    filterRegistered,
                    categoryFilter,
                }),
            });
            
            if (res.ok) {
                // Refresh local state from Firebase
                await refreshRace(raceId);
                alert('Results updated successfully!');
            } else {
                const data = await res.json();
                alert(`Failed: ${data.message}`);
            }
        } catch (e) {
            alert('Error updating results');
        } finally {
            setStatus('idle');
        }
    };

    const handleRaceUpdate = useCallback((updatedRace: Race) => {
        setRaces(prev => prev.map(r => r.id === updatedRace.id ? updatedRace : r));
    }, [setRaces]);

    // Loading state
    if (authLoading || status === 'loading') {
        return <div className="p-8 text-center">Loading...</div>;
    }

    const viewingRace = viewingResultsId ? races.find(r => r.id === viewingResultsId) || null : null;

    return (
        <div>
            {/* Tab Navigation */}
            <div className="flex gap-4 mb-8 border-b border-border">
                <button 
                    onClick={() => setActiveTab('races')}
                    className={`pb-2 px-4 font-medium transition ${
                        activeTab === 'races' 
                            ? 'text-primary border-b-2 border-primary' 
                            : 'text-muted-foreground hover:text-foreground'
                    }`}
                >
                    Races
                </button>
                <button 
                    onClick={() => setActiveTab('settings')}
                    className={`pb-2 px-4 font-medium transition ${
                        activeTab === 'settings' 
                            ? 'text-primary border-b-2 border-primary' 
                            : 'text-muted-foreground hover:text-foreground'
                    }`}
                >
                    Scoring Settings
                </button>
                <button 
                    onClick={() => setActiveTab('testing')}
                    className={`pb-2 px-4 font-medium transition ${
                        activeTab === 'testing' 
                            ? 'text-primary border-b-2 border-primary' 
                            : 'text-muted-foreground hover:text-foreground'
                    }`}
                >
                    Testing
                </button>
                <button 
                    onClick={() => setActiveTab('rawdata')}
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
                        onUpdateProfileSegment={raceForm.updateProfileSegment}
                        onAddProfileSegment={raceForm.addProfileSegment}
                        onRemoveProfileSegment={raceForm.removeProfileSegment}
                        onCancel={handleCancel}
                        onSave={handleSaveRace}
                    />

                    {/* Results Modal */}
                    {viewingRace && (
                        <ResultsModal
                            race={viewingRace}
                            status={status}
                            onClose={() => setViewingResultsId(null)}
                            onRefresh={() => handleRefreshResults(viewingRace.id)}
                            onRaceUpdate={handleRaceUpdate}
                        />
                    )}

                    {/* Race List */}
                    <RaceList
                        races={races}
                        leagueSettings={leagueSettings}
                        editingRaceId={raceForm.formState.editingRaceId}
                        status={status}
                        resultSource={resultSource}
                        filterRegistered={filterRegistered}
                        categoryFilter={categoryFilter}
                        onResultSourceChange={setResultSource}
                        onFilterRegisteredChange={setFilterRegistered}
                        onCategoryFilterChange={setCategoryFilter}
                        onEdit={handleEdit}
                        onDelete={handleDeleteRace}
                        onRefreshResults={handleRefreshResults}
                        onViewResults={setViewingResultsId}
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
