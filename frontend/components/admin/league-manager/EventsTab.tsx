'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { User } from 'firebase/auth';
import { API_URL } from '@/lib/api';
import type { LeagueSettings, LoadingStatus, Race, SeasonClass, StageRace } from '@/types/admin';
import RaceDefaultsEditor from './RaceDefaultsEditor';

interface EventsTabProps {
    user: User | null;
    races: Race[];
    stageRaces: StageRace[];
    leagueSettings: LeagueSettings;
    status: LoadingStatus;
    setStatus: (status: LoadingStatus) => void;
}

const CLASS_LABELS: Record<SeasonClass, string> = {
    tour: 'Tour (etaper + samlet)',
    monument: 'Monument (1-dags)',
    wt_classic: 'Stor WT-klassiker (1-dags)',
};

function phaseBadge(phase?: string) {
    const p = (phase || 'provisional').toLowerCase();
    const finalized = p === 'finalized';
    return (
        <span
            className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                finalized
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
                    : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
            }`}
        >
            {finalized ? 'Finalized' : 'Provisional'}
        </span>
    );
}

export default function EventsTab({
    user,
    races,
    stageRaces,
    leagueSettings,
    status,
    setStatus,
}: EventsTabProps) {
    const queryClient = useQueryClient();
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [createName, setCreateName] = useState('');
    const [createClass, setCreateClass] = useState<SeasonClass>('tour');
    const [createBest, setCreateBest] = useState(1);
    const [editName, setEditName] = useState('');
    const [editClass, setEditClass] = useState<SeasonClass>('tour');
    const [editBest, setEditBest] = useState(1);
    const [stageIds, setStageIds] = useState<string[]>([]);
    const [message, setMessage] = useState<string | null>(null);
    const [seasonName, setSeasonName] = useState(leagueSettings.name || '');
    const [archiveName, setArchiveName] = useState('');
    const [archiving, setArchiving] = useState(false);
    const [resetting, setResetting] = useState(false);

    useEffect(() => {
        setSeasonName(leagueSettings.name || '');
    }, [leagueSettings.name]);

    const selected = useMemo(
        () => stageRaces.find(e => e.id === selectedId) || null,
        [stageRaces, selectedId],
    );

    useEffect(() => {
        if (!selected) {
            setEditName('');
            setEditClass('tour');
            setEditBest(1);
            setStageIds([]);
            return;
        }
        setEditName(selected.name || '');
        setEditClass(selected.seasonClass || 'tour');
        setEditBest(selected.bestRacesCount || 1);
        const ordered = [...(selected.stages || [])].sort(
            (a, b) => (a.stageIndex || 0) - (b.stageIndex || 0),
        );
        setStageIds(ordered.map(s => s.id).filter(Boolean));
    }, [selected]);

    const raceById = useMemo(() => {
        const map = new Map<string, Race>();
        for (const r of races) map.set(r.id, r);
        return map;
    }, [races]);

    const availableRaces = useMemo(() => {
        return [...races]
            .filter(r => !r.stageRaceId || r.stageRaceId === selectedId)
            .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    }, [races, selectedId]);

    const authHeaders = async () => {
        const token = await user!.getIdToken();
        return {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        };
    };

    const refresh = async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['stageRaces'] }),
            queryClient.invalidateQueries({ queryKey: ['races'] }),
            queryClient.invalidateQueries({ queryKey: ['league', 'standings'] }),
        ]);
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user || !createName.trim()) return;
        setStatus('saving');
        setMessage(null);
        try {
            const res = await fetch(`${API_URL}/stage-races`, {
                method: 'POST',
                headers: await authHeaders(),
                body: JSON.stringify({
                    name: createName.trim(),
                    seasonClass: createClass,
                    bestRacesCount: createBest,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMessage(data.message || 'Failed to create event');
                return;
            }
            setCreateName('');
            setCreateClass('tour');
            setCreateBest(createClass === 'tour' ? 4 : 1);
            setSelectedId(data.id || null);
            setMessage('Event created');
            await refresh();
        } catch {
            setMessage('Error creating event');
        } finally {
            setStatus('idle');
        }
    };

    const handleSaveMeta = async () => {
        if (!user || !selectedId) return;
        setStatus('saving');
        setMessage(null);
        try {
            const res = await fetch(`${API_URL}/stage-races/${selectedId}`, {
                method: 'PUT',
                headers: await authHeaders(),
                body: JSON.stringify({
                    name: editName.trim(),
                    seasonClass: editClass,
                    bestRacesCount: editBest,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMessage(data.message || 'Failed to update event');
                return;
            }
            setMessage('Event updated');
            await refresh();
        } catch {
            setMessage('Error updating event');
        } finally {
            setStatus('idle');
        }
    };

    const handleSaveStages = async () => {
        if (!user || !selectedId) return;
        if (selected?.resultsPhase === 'finalized') {
            setMessage('Un-finalize the event before changing stages');
            return;
        }
        setStatus('saving');
        setMessage(null);
        try {
            const res = await fetch(`${API_URL}/stage-races/${selectedId}/stages`, {
                method: 'PUT',
                headers: await authHeaders(),
                body: JSON.stringify({
                    stages: stageIds.map((raceId, i) => ({
                        raceId,
                        stageIndex: i + 1,
                    })),
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMessage(data.message || 'Failed to update stages');
                return;
            }
            setMessage('Stages updated');
            await refresh();
        } catch {
            setMessage('Error updating stages');
        } finally {
            setStatus('idle');
        }
    };

    const handleFinalize = async (action: 'finalize' | 'unfinalize') => {
        if (!user || !selectedId) return;
        const label = action === 'finalize' ? 'finalize' : 'un-finalize';
        if (!confirm(`Are you sure you want to ${label} this event?`)) return;
        setStatus('saving');
        setMessage(null);
        try {
            const res = await fetch(`${API_URL}/stage-races/${selectedId}/${action}`, {
                method: 'POST',
                headers: await authHeaders(),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMessage(data.message || `Failed to ${label} event`);
                return;
            }
            setMessage(action === 'finalize' ? 'Event finalized' : 'Event un-finalized');
            await refresh();
        } catch {
            setMessage(`Error trying to ${label} event`);
        } finally {
            setStatus('idle');
        }
    };

    const handleDelete = async () => {
        if (!user || !selectedId) return;
        if (!confirm('Delete this event? Stages will be detached (races kept).')) return;
        setStatus('saving');
        setMessage(null);
        try {
            const res = await fetch(`${API_URL}/stage-races/${selectedId}`, {
                method: 'DELETE',
                headers: await authHeaders(),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMessage(data.message || 'Failed to delete event');
                return;
            }
            setSelectedId(null);
            setMessage('Event deleted');
            await refresh();
        } catch {
            setMessage('Error deleting event');
        } finally {
            setStatus('idle');
        }
    };

    const toggleStage = (raceId: string) => {
        setStageIds(prev =>
            prev.includes(raceId) ? prev.filter(id => id !== raceId) : [...prev, raceId],
        );
    };

    const moveStage = (raceId: string, dir: -1 | 1) => {
        setStageIds(prev => {
            const idx = prev.indexOf(raceId);
            if (idx < 0) return prev;
            const next = idx + dir;
            if (next < 0 || next >= prev.length) return prev;
            const copy = [...prev];
            [copy[idx], copy[next]] = [copy[next], copy[idx]];
            return copy;
        });
    };

    const allStagesFinalized =
        stageIds.length > 0 &&
        stageIds.every(id => (raceById.get(id)?.resultsPhase || '').toLowerCase() === 'finalized');

    const handleSaveSeasonName = async () => {
        if (!user) return;
        setStatus('saving');
        setMessage(null);
        try {
            const res = await fetch(`${API_URL}/league/settings`, {
                method: 'POST',
                headers: await authHeaders(),
                body: JSON.stringify({ ...leagueSettings, name: seasonName }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                setMessage(data.message || 'Failed to save season name');
                return;
            }
            setMessage('Season name saved');
            await queryClient.invalidateQueries({ queryKey: ['league', 'settings'] });
        } catch {
            setMessage('Error saving season name');
        } finally {
            setStatus('idle');
        }
    };

    return (
        <div className="space-y-8">
            <div className="bg-card p-6 rounded-lg shadow border border-border">
                <h2 className="text-xl font-semibold mb-1 text-card-foreground">Season</h2>
                <p className="text-sm text-muted-foreground mb-4">
                    Name the current season, then create events and attach races from the Races tab.
                </p>
                <div className="flex flex-wrap gap-4 items-end">
                    <div className="flex-1 min-w-[220px]">
                        <label className="block text-sm font-medium text-muted-foreground mb-1">Season name</label>
                        <input
                            type="text"
                            value={seasonName}
                            onChange={e => setSeasonName(e.target.value)}
                            className="w-full p-2 border border-input rounded bg-background text-foreground"
                            placeholder="e.g. DCU Memberliga forår 2026"
                        />
                    </div>
                    <button
                        type="button"
                        onClick={handleSaveSeasonName}
                        disabled={status === 'saving'}
                        className="bg-primary text-primary-foreground px-4 py-2 rounded hover:opacity-90 font-medium"
                    >
                        {status === 'saving' ? 'Saving...' : 'Save name'}
                    </button>
                </div>
            </div>

            <RaceDefaultsEditor
                user={user}
                leagueSettings={leagueSettings}
                status={status}
                setStatus={setStatus}
                onMessage={setMessage}
            />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="space-y-6">
                <div className="bg-card p-6 rounded-lg shadow border border-border">
                    <h2 className="text-xl font-semibold mb-4 text-card-foreground">Create event</h2>
                    <form onSubmit={handleCreate} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium mb-1">Name</label>
                            <input
                                value={createName}
                                onChange={e => setCreateName(e.target.value)}
                                className="w-full p-2 border border-input rounded bg-background"
                                placeholder="e.g. Tour of Watopia"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Class</label>
                            <select
                                value={createClass}
                                onChange={e => {
                                    const next = e.target.value as SeasonClass;
                                    setCreateClass(next);
                                    setCreateBest(next === 'tour' ? 4 : 1);
                                }}
                                className="w-full p-2 border border-input rounded bg-background"
                            >
                                {(Object.keys(CLASS_LABELS) as SeasonClass[]).map(key => (
                                    <option key={key} value={key}>{CLASS_LABELS[key]}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Best stages (GC)</label>
                            <input
                                type="number"
                                min={1}
                                value={createBest}
                                onChange={e => setCreateBest(parseInt(e.target.value, 10) || 1)}
                                className="w-24 p-2 border border-input rounded bg-background"
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                                One-day events usually use 1.
                            </p>
                        </div>
                        <button
                            type="submit"
                            disabled={status === 'saving'}
                            className="bg-primary text-primary-foreground px-4 py-2 rounded hover:opacity-90 font-medium"
                        >
                            Create
                        </button>
                    </form>
                </div>

                <div className="bg-card p-6 rounded-lg shadow border border-border">
                    <h2 className="text-xl font-semibold mb-4 text-card-foreground">Season events</h2>
                    {stageRaces.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No events yet. Create one above.</p>
                    ) : (
                        <ul className="space-y-2">
                            {stageRaces.map(ev => (
                                <li key={ev.id}>
                                    <button
                                        type="button"
                                        onClick={() => setSelectedId(ev.id)}
                                        className={`w-full text-left p-3 rounded border transition ${
                                            selectedId === ev.id
                                                ? 'border-primary bg-primary/5'
                                                : 'border-border hover:bg-muted/40'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="font-medium">{ev.name}</span>
                                            {phaseBadge(ev.resultsPhase)}
                                        </div>
                                        <div className="text-xs text-muted-foreground mt-1">
                                            {CLASS_LABELS[ev.seasonClass] || ev.seasonClass}
                                            {' · '}
                                            best {ev.bestRacesCount}
                                            {' · '}
                                            {(ev.stages || []).length} stage(s)
                                        </div>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>

            <div className="lg:col-span-2 space-y-6">
                {message && (
                    <div className="bg-muted/50 border border-border rounded px-4 py-2 text-sm">
                        {message}
                    </div>
                )}

                {!selected ? (
                    <div className="bg-card p-8 rounded-lg shadow border border-border text-muted-foreground">
                        Select or create an event to attach stages and finalize.
                    </div>
                ) : (
                    <>
                        <div className="bg-card p-6 rounded-lg shadow border border-border space-y-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <h2 className="text-xl font-semibold text-card-foreground">
                                    {selected.name}
                                </h2>
                                <div className="flex flex-wrap gap-2">
                                    {selected.resultsPhase === 'finalized' ? (
                                        <button
                                            type="button"
                                            onClick={() => handleFinalize('unfinalize')}
                                            disabled={status === 'saving'}
                                            className="px-3 py-1.5 rounded border border-input text-sm hover:bg-muted"
                                        >
                                            Un-finalize event
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => handleFinalize('finalize')}
                                            disabled={status === 'saving' || !allStagesFinalized}
                                            className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-sm disabled:opacity-50"
                                            title={
                                                allStagesFinalized
                                                    ? undefined
                                                    : 'All stages must be finalized first'
                                            }
                                        >
                                            Finalize event
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={handleDelete}
                                        disabled={status === 'saving'}
                                        className="px-3 py-1.5 rounded border border-destructive text-destructive text-sm hover:bg-destructive/10"
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium mb-1">Name</label>
                                    <input
                                        value={editName}
                                        onChange={e => setEditName(e.target.value)}
                                        className="w-full p-2 border border-input rounded bg-background"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">Best stages (GC)</label>
                                    <input
                                        type="number"
                                        min={1}
                                        value={editBest}
                                        onChange={e => setEditBest(parseInt(e.target.value, 10) || 1)}
                                        className="w-full p-2 border border-input rounded bg-background"
                                    />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium mb-1">Class</label>
                                    <select
                                        value={editClass}
                                        onChange={e => setEditClass(e.target.value as SeasonClass)}
                                        className="w-full p-2 border border-input rounded bg-background"
                                    >
                                        {(Object.keys(CLASS_LABELS) as SeasonClass[]).map(key => (
                                            <option key={key} value={key}>{CLASS_LABELS[key]}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex items-end">
                                    <button
                                        type="button"
                                        onClick={handleSaveMeta}
                                        disabled={status === 'saving'}
                                        className="w-full bg-secondary text-secondary-foreground px-4 py-2 rounded hover:opacity-90"
                                    >
                                        Save details
                                    </button>
                                </div>
                            </div>

                            {!allStagesFinalized && selected.resultsPhase !== 'finalized' && (
                                <p className="text-xs text-muted-foreground">
                                    Finalize each stage under Results before finalizing the event.
                                    Monument / WT classics auto-finalize when their single stage is finalized.
                                </p>
                            )}
                        </div>

                        <div className="bg-card p-6 rounded-lg shadow border border-border space-y-4">
                            <div className="flex items-center justify-between gap-3">
                                <h3 className="text-lg font-semibold">Stages</h3>
                                <button
                                    type="button"
                                    onClick={handleSaveStages}
                                    disabled={status === 'saving' || selected.resultsPhase === 'finalized'}
                                    className="bg-primary text-primary-foreground px-4 py-2 rounded text-sm disabled:opacity-50"
                                >
                                    Save stage order
                                </button>
                            </div>

                            {stageIds.length > 0 && (
                                <ol className="space-y-2 mb-4">
                                    {stageIds.map((id, index) => {
                                        const race = raceById.get(id);
                                        return (
                                            <li
                                                key={id}
                                                className="flex items-center gap-2 p-2 border border-border rounded"
                                            >
                                                <span className="text-sm font-mono w-6">{index + 1}.</span>
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-medium truncate">
                                                        {race?.name || id}
                                                    </div>
                                                    <div className="text-xs text-muted-foreground">
                                                        {race?.date || '—'} · {phaseBadge(race?.resultsPhase)}
                                                    </div>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => moveStage(id, -1)}
                                                    disabled={index === 0 || selected.resultsPhase === 'finalized'}
                                                    className="px-2 py-1 text-xs border rounded disabled:opacity-40"
                                                >
                                                    ↑
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => moveStage(id, 1)}
                                                    disabled={
                                                        index === stageIds.length - 1
                                                        || selected.resultsPhase === 'finalized'
                                                    }
                                                    className="px-2 py-1 text-xs border rounded disabled:opacity-40"
                                                >
                                                    ↓
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => toggleStage(id)}
                                                    disabled={selected.resultsPhase === 'finalized'}
                                                    className="px-2 py-1 text-xs border border-destructive text-destructive rounded disabled:opacity-40"
                                                >
                                                    Remove
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ol>
                            )}

                            <div>
                                <p className="text-sm font-medium mb-2">Attach races</p>
                                {availableRaces.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">
                                        No unattached races. Create races under the Races tab first.
                                    </p>
                                ) : (
                                    <ul className="space-y-1 max-h-64 overflow-y-auto border border-border rounded p-2">
                                        {availableRaces.map(race => {
                                            const checked = stageIds.includes(race.id);
                                            return (
                                                <li key={race.id}>
                                                    <label className="flex items-center gap-2 p-1.5 rounded hover:bg-muted/40 cursor-pointer text-sm">
                                                        <input
                                                            type="checkbox"
                                                            checked={checked}
                                                            disabled={selected.resultsPhase === 'finalized'}
                                                            onChange={() => toggleStage(race.id)}
                                                        />
                                                        <span className="flex-1 truncate">{race.name}</span>
                                                        <span className="text-xs text-muted-foreground">
                                                            {race.date}
                                                        </span>
                                                    </label>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </div>
                        </div>
                    </>
                )}
            </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-card p-6 rounded-lg shadow border border-border flex flex-col">
                    <h2 className="text-lg font-semibold mb-1 text-card-foreground">Arkivér sæson</h2>
                    <p className="text-sm text-muted-foreground mb-4">
                        Gem et snapshot af den aktuelle sæsons løb, events, stilling og indstillinger til historikken. De aktuelle data berøres ikke.
                    </p>
                    <div className="space-y-3 flex-1 flex flex-col">
                        <div>
                            <label className="block text-sm font-medium text-muted-foreground mb-1">Arkivnavn</label>
                            <input
                                type="text"
                                value={archiveName}
                                onChange={e => setArchiveName(e.target.value)}
                                placeholder={`${leagueSettings.name || 'Forårsliga'} ${new Date().getFullYear()}`}
                                className="w-full p-2 border border-input rounded bg-background text-foreground text-sm"
                            />
                        </div>
                        <button
                            type="button"
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
                                    if (res.ok) {
                                        const drCount = typeof data.drVerificationCount === 'number' ? data.drVerificationCount : null;
                                        const stageCount = typeof data.stageRaceCount === 'number' ? data.stageRaceCount : null;
                                        alert(
                                            `Sæson arkiveret! ${data.raceCount} løb gemt under "${name}".` +
                                            (stageCount !== null ? ` (${stageCount} events)` : '') +
                                            (drCount !== null ? ` (${drCount} dual-recording verifikationer)` : '')
                                        );
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

                <div className="bg-card p-6 rounded-lg shadow border border-red-200 dark:border-red-900 flex flex-col">
                    <h2 className="text-lg font-semibold mb-1 text-red-700 dark:text-red-400">Nulstil sæson</h2>
                    <p className="text-sm text-muted-foreground mb-4">
                        Sletter alle løb og events og nulstiller stillingen. Scoring-indstillinger og kategoriopsætning bevares.{' '}
                        <strong className="text-red-600 dark:text-red-400">Kan ikke fortrydes.</strong>
                    </p>
                    <button
                        type="button"
                        disabled={resetting}
                        onClick={async () => {
                            if (!confirm('ADVARSEL: Dette sletter alle løb/events og nulstiller stillingen permanent.\n\nHar du arkiveret sæsonen først?\n\nFortsæt?')) return;
                            if (!confirm('Er du helt sikker? Alle løbsdata slettes permanent.')) return;
                            setResetting(true);
                            try {
                                const token = await user?.getIdToken();
                                const res = await fetch(`${API_URL}/admin/reset-season`, {
                                    method: 'POST',
                                    headers: { Authorization: `Bearer ${token}` },
                                });
                                const data = await res.json();
                                if (res.ok) {
                                    const nested = typeof data.nestedDocsDeleted === 'number' ? data.nestedDocsDeleted : null;
                                    const stagesDeleted = typeof data.stageRacesDeleted === 'number' ? data.stageRacesDeleted : null;
                                    alert(
                                        `Sæson nulstillet. ${data.racesDeleted} løb slettet.` +
                                        (stagesDeleted !== null ? ` (${stagesDeleted} events)` : '') +
                                        (nested !== null ? ` (${nested} underdokumenter)` : '')
                                    );
                                    await queryClient.invalidateQueries({ queryKey: ['races'] });
                                    await queryClient.invalidateQueries({ queryKey: ['stageRaces'] });
                                    await queryClient.invalidateQueries({ queryKey: ['league', 'standings'] });
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
        </div>
    );
}
