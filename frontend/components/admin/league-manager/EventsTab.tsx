'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { User } from 'firebase/auth';
import { API_URL } from '@/lib/api';
import type { LoadingStatus, Race, SeasonClass, StageRace } from '@/types/admin';

interface EventsTabProps {
    user: User | null;
    races: Race[];
    stageRaces: StageRace[];
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

    return (
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
                    <h2 className="text-xl font-semibold mb-4 text-card-foreground">Events</h2>
                    {stageRaces.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No events yet.</p>
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
    );
}
