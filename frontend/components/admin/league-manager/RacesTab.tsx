'use client';

import { useEffect, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRaceForm } from '@/hooks/useRaceForm';
import { fetchSegments, calculateRouteTotals } from '@/hooks/useLeagueData';
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

    const handleCancel = useCallback(
        () => raceForm.resetForm(leagueSettings),
        [raceForm, leagueSettings],
    );

    // Re-apply season defaults when they change, only for a blank (non-editing) form
    const defaultsKey = JSON.stringify({
        mode: leagueSettings.defaultEventMode ?? null,
        single: leagueSettings.defaultSingleCategories ?? null,
        multi: leagueSettings.defaultEventConfiguration ?? null,
        groups: leagueSettings.defaultRaceGroups ?? null,
    });
    useEffect(() => {
        if (raceForm.formState.editingRaceId) return;
        raceForm.resetForm(leagueSettings);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only when defaults change
    }, [defaultsKey]);

    const handleSaveRace = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;
        const selectedRoute = routes.find(r => r.id === raceForm.formState.selectedRouteId);
        if (!selectedRoute) return;

        setStatus('saving');
        try {
            const token = await user.getIdToken();
            const { formState } = raceForm;
            const { totalDistance, totalElevation } = calculateRouteTotals(selectedRoute, formState.laps);
            const raceData: Partial<Race> = {
                name: formState.name,
                date: formState.date,
                type: formState.raceType,
                routeId: selectedRoute.id,
                routeName: selectedRoute.name,
                map: selectedRoute.map,
                laps: formState.laps,
                totalDistance,
                totalElevation,
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
                raceForm.resetForm(leagueSettings);
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
        </>
    );
}
