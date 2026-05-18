'use client';

import { useEffect, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRaceForm } from '@/hooks/useRaceForm';
import { fetchSegments } from '@/hooks/useLeagueData';
import { API_URL } from '@/lib/api';
import { User } from 'firebase/auth';
import type { Race, Route, Segment, LeagueSettings, LoadingStatus } from '@/types/admin';
import RaceForm from './RaceForm';
import RaceList from './RaceList';

interface RacesTabProps {
    user: User | null;
    races: Race[];
    routes: Route[];
    leagueSettings: LeagueSettings;
    status: LoadingStatus;
    setStatus: (s: LoadingStatus) => void;
}

export default function RacesTab({
    user,
    races,
    routes,
    leagueSettings,
    status,
    setStatus,
}: RacesTabProps) {
    const queryClient = useQueryClient();
    const raceForm = useRaceForm();
    const [availableSegments, setAvailableSegments] = useState<Segment[]>([]);
    const [leagueName, setLeagueName] = useState(leagueSettings.name || '');
    const [archiveName, setArchiveName] = useState('');
    const [archiving, setArchiving] = useState(false);
    const [resetting, setResetting] = useState(false);

    useEffect(() => {
        setLeagueName(leagueSettings.name || '');
    }, [leagueSettings.name]);

    const eventConfigLapSig = raceForm.formState.eventConfiguration.map(c => c.laps ?? 0).join(',');
    const singleCatLapSig = raceForm.formState.singleModeCategories.map(c => c.laps ?? 0).join(',');
    const raceGroupLapSig = raceForm.formState.raceGroups.map(g => g.laps ?? 0).join(',');

    useEffect(() => {
        const loadSegments = async () => {
            if (!raceForm.formState.selectedRouteId) { setAvailableSegments([]); return; }

            let maxLaps = raceForm.formState.laps;
            if (raceForm.formState.eventMode === 'multi' && raceForm.formState.eventConfiguration.length > 0) {
                maxLaps = Math.max(maxLaps, ...raceForm.formState.eventConfiguration.map(c => c.laps || 0));
            }
            if (raceForm.formState.eventMode === 'single' && raceForm.formState.singleModeCategories.length > 0) {
                maxLaps = Math.max(maxLaps, ...raceForm.formState.singleModeCategories.map(c => c.laps || 0));
            }
            if (raceForm.formState.eventMode === 'grouped' && raceForm.formState.raceGroups.length > 0) {
                maxLaps = Math.max(maxLaps, ...raceForm.formState.raceGroups.map(g => g.laps || 0));
            }

            setAvailableSegments(await fetchSegments(raceForm.formState.selectedRouteId, maxLaps));
        };
        loadSegments();
    }, [
        raceForm.formState.selectedRouteId,
        raceForm.formState.laps,
        raceForm.formState.eventMode,
        eventConfigLapSig,
        singleCatLapSig,
        raceGroupLapSig,
    ]);

    const handleEdit = useCallback((race: Race) => {
        raceForm.loadRace(race);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [raceForm]);

    const handleCancel = useCallback(() => raceForm.resetForm(), [raceForm]);

    const handleSaveRace = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;
        const selectedRoute = routes.find(r => r.id === raceForm.formState.selectedRouteId);
        if (!selectedRoute) return;

        setStatus('saving');
        try {
            const token = await user.getIdToken();
            const { formState } = raceForm;
            const raceData: Partial<Race> = {
                name: formState.name,
                date: formState.date,
                type: formState.raceType,
                routeId: selectedRoute.id,
                routeName: selectedRoute.name,
                map: selectedRoute.map,
                laps: formState.laps,
                totalDistance: Number((selectedRoute.distance * formState.laps + selectedRoute.leadinDistance).toFixed(1)),
                totalElevation: Math.round(selectedRoute.elevation * formState.laps + selectedRoute.leadinElevation),
                selectedSegments: formState.selectedSprints.map(s => s.key),
                sprints: formState.selectedSprints,
                segmentType: formState.segmentType,
                eventMode: formState.eventMode,
            };

            if (formState.eventMode === 'single') {
                raceData.eventId = formState.eventId;
                raceData.eventSecret = formState.eventSecret;
                raceData.eventConfiguration = [];
                raceData.singleModeCategories = formState.singleModeCategories;
                raceData.raceGroups = [];
                raceData.linkedEventIds = formState.eventId ? [formState.eventId] : [];
            } else if (formState.eventMode === 'grouped') {
                raceData.raceGroups = formState.raceGroups;
                raceData.eventConfiguration = [];
                raceData.singleModeCategories = [];
                raceData.eventId = '';
                raceData.eventSecret = '';
                raceData.linkedEventIds = [...new Set(formState.raceGroups.map(g => g.eventId).filter(Boolean))];
            } else {
                raceData.eventConfiguration = formState.eventConfiguration;
                raceData.singleModeCategories = [];
                raceData.raceGroups = [];
                raceData.eventId = '';
                raceData.eventSecret = '';
                raceData.linkedEventIds = formState.eventConfiguration.map(c => c.eventId).filter(Boolean);
            }

            const method = formState.editingRaceId ? 'PUT' : 'POST';
            const url = formState.editingRaceId ? `${API_URL}/races/${formState.editingRaceId}` : `${API_URL}/races`;
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify(raceData),
            });

            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data.warnings) && data.warnings.length > 0) {
                    alert(`Race saved with warnings:\n- ${data.warnings.join('\n- ')}`);
                }
                raceForm.resetForm();
                await queryClient.invalidateQueries({ queryKey: ['races'] });
            } else {
                const err = await res.json();
                alert(`Error: ${err.message}`);
            }
        } catch {
            alert('Failed to save race');
        } finally {
            setStatus('idle');
        }
    };

    const handleDeleteRace = async (id: string) => {
        if (!user || !confirm('Delete this race?')) return;
        try {
            const token = await user.getIdToken();
            await fetch(`${API_URL}/races/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
            await queryClient.invalidateQueries({ queryKey: ['races'] });
        } catch {
            alert('Failed to delete');
        }
    };

    return (
        <>
            {/* League Name */}
            <div className="bg-card p-6 rounded-lg shadow mb-8 border border-border">
                <h2 className="text-xl font-semibold mb-4 text-card-foreground">League Configuration</h2>
                <div className="flex gap-4 items-end">
                    <div className="flex-1">
                        <label className="block text-sm font-medium text-muted-foreground mb-1">League Name</label>
                        <input
                            type="text"
                            value={leagueName}
                            onChange={e => setLeagueName(e.target.value)}
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
                                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                                    body: JSON.stringify({ ...leagueSettings, name: leagueName }),
                                });
                                alert('Name saved!');
                                await queryClient.invalidateQueries({ queryKey: ['league', 'settings'] });
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
                                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                                        body: JSON.stringify({ name }),
                                    });
                                    const data = await res.json();
                                    if (res.ok) { alert(`Sæson arkiveret! ${data.raceCount} løb gemt under "${name}".`); setArchiveName(''); }
                                    else alert(`Fejl: ${data.message}`);
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

                <div className="bg-card p-6 rounded-lg shadow border border-red-200 dark:border-red-900 flex flex-col">
                    <h2 className="text-lg font-semibold mb-1 text-red-700 dark:text-red-400">Nulstil sæson</h2>
                    <p className="text-sm text-muted-foreground mb-4">
                        Sletter alle løb og nulstiller stillingen. Scoring-indstillinger og kategoriopsætning bevares.{' '}
                        <strong className="text-red-600 dark:text-red-400">Kan ikke fortrydes.</strong>
                    </p>
                    <button
                        disabled={resetting}
                        onClick={async () => {
                            if (!confirm('ADVARSEL: Dette sletter alle løb og nulstiller stillingen permanent.\n\nHar du arkiveret sæsonen først?\n\nFortsæt?')) return;
                            if (!confirm('Er du helt sikker? Alle løbsdata slettes permanent.')) return;
                            setResetting(true);
                            try {
                                const token = await user?.getIdToken();
                                const res = await fetch(`${API_URL}/admin/reset-season`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
                                const data = await res.json();
                                if (res.ok) {
                                    alert(`Sæson nulstillet. ${data.racesDeleted} løb slettet.`);
                                    await queryClient.invalidateQueries({ queryKey: ['races'] });
                                }
                                else alert(`Fejl: ${data.message}`);
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
    );
}
