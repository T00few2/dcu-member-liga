'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { User } from 'firebase/auth';
import { API_URL } from '@/lib/api';
import type {
    DefaultEventConfigRow,
    DefaultCategoryRow,
    DefaultRaceGroup,
    EventMode,
    LeagueSettings,
    LoadingStatus,
} from '@/types/admin';

interface Props {
    user: User | null;
    leagueSettings: LeagueSettings;
    status: LoadingStatus;
    setStatus: (s: LoadingStatus) => void;
    onMessage?: (msg: string | null) => void;
}

function newGroupId(): string {
    return `default-group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function RaceDefaultsEditor({
    user,
    leagueSettings,
    status,
    setStatus,
    onMessage,
}: Props) {
    const queryClient = useQueryClient();
    const [mode, setMode] = useState<EventMode>(leagueSettings.defaultEventMode || 'single');
    const [singleCats, setSingleCats] = useState<DefaultCategoryRow[]>([]);
    const [multiRows, setMultiRows] = useState<DefaultEventConfigRow[]>([]);
    const [groups, setGroups] = useState<DefaultRaceGroup[]>([]);
    const [enforcePreview, setEnforcePreview] = useState<Record<string, unknown> | null>(null);
    const [enforcing, setEnforcing] = useState(false);

    const categoryOptions = (leagueSettings.ligaCategories || [])
        .map((c) => c.name)
        .filter(Boolean);

    useEffect(() => {
        setMode(leagueSettings.defaultEventMode || 'single');
        setSingleCats(
            (leagueSettings.defaultSingleCategories || []).map((c) => ({
                category: c.category || '',
                laps: c.laps,
            })),
        );
        setMultiRows(
            (leagueSettings.defaultEventConfiguration || []).map((c) => ({
                customCategory: c.customCategory || '',
                laps: c.laps,
            })),
        );
        setGroups(
            (leagueSettings.defaultRaceGroups || []).map((g) => ({
                id: g.id || newGroupId(),
                name: g.name || '',
                laps: g.laps,
                categories: (g.categories || []).map((c) => ({ category: c.category || '' })),
            })),
        );
    }, [leagueSettings]);

    const persistDefaults = async (): Promise<boolean> => {
        if (!user) return false;
        setStatus('saving');
        onMessage?.(null);
        try {
            const token = await user.getIdToken();
            const res = await fetch(`${API_URL}/league/settings`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    ...leagueSettings,
                    defaultEventMode: mode,
                    defaultSingleCategories: singleCats,
                    defaultEventConfiguration: multiRows,
                    defaultRaceGroups: groups,
                }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                onMessage?.(data.message || 'Failed to save race defaults');
                return false;
            }
            await queryClient.invalidateQueries({ queryKey: ['league', 'settings'] });
            return true;
        } catch {
            onMessage?.('Error saving race defaults');
            return false;
        } finally {
            setStatus('idle');
        }
    };

    const handleSave = async () => {
        const ok = await persistDefaults();
        if (ok) onMessage?.('Race defaults saved');
    };

    const handlePreviewEnforce = async () => {
        if (!user) return;
        setEnforcing(true);
        onMessage?.(null);
        try {
            const token = await user.getIdToken();
            const res = await fetch(`${API_URL}/admin/races/enforce-race-structure`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ dryRun: true }),
            });
            const data = await res.json();
            if (!res.ok) {
                onMessage?.(data.message || 'Preview failed');
                return;
            }
            setEnforcePreview(data);
            const drops = (data.races || []).filter((r: { wouldDropEventId?: boolean }) => r.wouldDropEventId);
            if (drops.length) {
                onMessage?.(`Preview: ${drops.length} race(s) would drop an eventId on group rename. Review before enforce.`);
            } else {
                onMessage?.('Preview of the last saved template. Unsaved editor changes are not included — Save first, or use Save and enforce.');
            }
        } catch {
            onMessage?.('Preview failed');
        } finally {
            setEnforcing(false);
        }
    };

    const handleSaveAndEnforce = async () => {
        if (!user) return;
        if (!confirm(
            'Save these race defaults, then overlay them onto existing grouped races? Event IDs are kept when the group name or id still matches. Category sprints follow the category. Signups are not auto-synced to Zwift.',
        )) return;
        setEnforcing(true);
        onMessage?.(null);
        try {
            const saved = await persistDefaults();
            if (!saved) return;
            const token = await user.getIdToken();
            const previewRes = await fetch(`${API_URL}/admin/races/enforce-race-structure`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ dryRun: true }),
            });
            const preview = await previewRes.json();
            if (!previewRes.ok) {
                onMessage?.(preview.message || 'Saved defaults, but enforce preview failed');
                return;
            }
            setEnforcePreview(preview);
            if (preview.coverage && preview.coverage.ok === false) {
                onMessage?.(preview.message || 'Saved defaults, but every liga category must appear in exactly one group');
                return;
            }
            const races = (preview.races || []) as { wouldDropEventId?: boolean; name?: string; wouldDropGroupsWithSprints?: string[] }[];
            const drops = races.filter((r) => r.wouldDropEventId);
            if (drops.length) {
                if (!confirm(`Enforce would drop event IDs on: ${drops.map((d) => d.name).join(', ')}. Continue?`)) {
                    onMessage?.('Race defaults saved. Enforce cancelled.');
                    return;
                }
            }
            const sprintDrops = races.filter((r) => (r.wouldDropGroupsWithSprints || []).length);
            if (sprintDrops.length) {
                if (!confirm('Some race groups will be removed. Category sprints are kept by name; group-only sprints on dropped groups are copied onto a remaining group when that group has none. Continue?')) {
                    onMessage?.('Race defaults saved. Enforce cancelled.');
                    return;
                }
            }
            const res = await fetch(`${API_URL}/admin/races/enforce-race-structure`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ dryRun: false }),
            });
            const data = await res.json();
            if (!res.ok) {
                onMessage?.(data.message || 'Enforce failed');
                return;
            }
            setEnforcePreview(null);
            onMessage?.(
                `Defaults saved. ${data.message || 'Enforced'}` +
                (data.syncSignupsReminder ? ' If event IDs are set, sync signups per race.' : ''),
            );
            await queryClient.invalidateQueries({ queryKey: ['races'] });
        } catch {
            onMessage?.('Save and enforce failed');
        } finally {
            setEnforcing(false);
        }
    };

    const categoryInput = (
        value: string,
        onChange: (v: string) => void,
        placeholder = 'e.g. Diamond',
    ) => (
        categoryOptions.length > 0 ? (
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-full p-2 border border-input rounded bg-background text-sm"
            >
                <option value="">Select category</option>
                {categoryOptions.map((name) => (
                    <option key={name} value={name}>{name}</option>
                ))}
                {value && !categoryOptions.includes(value) && (
                    <option value={value}>{value}</option>
                )}
            </select>
        ) : (
            <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-full p-2 border border-input rounded bg-background text-sm"
                placeholder={placeholder}
            />
        )
    );

    return (
        <div className="bg-card p-6 rounded-lg shadow border border-border space-y-4">
            <div>
                <h2 className="text-xl font-semibold text-card-foreground">Race defaults</h2>
                <p className="text-sm text-muted-foreground mt-1">
                    Set event mode and category structure once. New races clone this template;
                    you fill Zwift event IDs (and route/sprints) per race. <strong>Save race defaults</strong> updates
                    the template only. <strong>Save and enforce</strong> writes the template, then overlays it onto
                    existing grouped races.
                </p>
            </div>

            <div>
                <label className="block text-sm font-medium mb-2">Default event mode</label>
                <div className="flex flex-wrap gap-4">
                    {(
                        [
                            ['single', 'Single (one event, multiple categories)'],
                            ['multi', 'Multi (one event per category)'],
                            ['grouped', 'Grouped (events covering multiple categories)'],
                        ] as const
                    ).map(([value, label]) => (
                        <label key={value} className="flex items-center gap-2 text-sm cursor-pointer">
                            <input
                                type="radio"
                                name="defaultEventMode"
                                checked={mode === value}
                                onChange={() => setMode(value)}
                            />
                            {label}
                        </label>
                    ))}
                </div>
            </div>

            {mode === 'single' && (
                <div className="space-y-2 border border-border rounded-lg p-4">
                    <div className="flex items-center justify-between">
                        <h3 className="font-medium text-sm">Categories</h3>
                        <button
                            type="button"
                            onClick={() => setSingleCats((prev) => [...prev, { category: '' }])}
                            className="text-sm px-2 py-1 border border-input rounded hover:bg-muted"
                        >
                            Add category
                        </button>
                    </div>
                    {singleCats.length === 0 && (
                        <p className="text-xs text-muted-foreground">No categories yet.</p>
                    )}
                    {singleCats.map((row, idx) => (
                        <div key={idx} className="flex gap-2 items-center">
                            <div className="flex-1">
                                {categoryInput(row.category, (v) => {
                                    setSingleCats((prev) => prev.map((r, i) => (i === idx ? { ...r, category: v } : r)));
                                })}
                            </div>
                            <button
                                type="button"
                                onClick={() => setSingleCats((prev) => prev.filter((_, i) => i !== idx))}
                                className="text-red-500 px-2"
                            >
                                ✕
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {mode === 'multi' && (
                <div className="space-y-2 border border-border rounded-lg p-4">
                    <div className="flex items-center justify-between">
                        <h3 className="font-medium text-sm">Category rows (event ID per race)</h3>
                        <button
                            type="button"
                            onClick={() => setMultiRows((prev) => [...prev, { customCategory: '' }])}
                            className="text-sm px-2 py-1 border border-input rounded hover:bg-muted"
                        >
                            Add row
                        </button>
                    </div>
                    {multiRows.length === 0 && (
                        <p className="text-xs text-muted-foreground">No rows yet.</p>
                    )}
                    {multiRows.map((row, idx) => (
                        <div key={idx} className="flex gap-2 items-center">
                            <div className="flex-1">
                                {categoryInput(row.customCategory, (v) => {
                                    setMultiRows((prev) => prev.map((r, i) => (i === idx ? { ...r, customCategory: v } : r)));
                                })}
                            </div>
                            <button
                                type="button"
                                onClick={() => setMultiRows((prev) => prev.filter((_, i) => i !== idx))}
                                className="text-red-500 px-2"
                            >
                                ✕
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {mode === 'grouped' && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="font-medium text-sm">Groups (event ID per group on each race)</h3>
                        <button
                            type="button"
                            onClick={() => setGroups((prev) => [...prev, {
                                id: newGroupId(),
                                name: '',
                                categories: [],
                            }])}
                            className="text-sm px-2 py-1 border border-input rounded hover:bg-muted"
                        >
                            Add group
                        </button>
                    </div>
                    {groups.length === 0 && (
                        <p className="text-xs text-muted-foreground">No groups yet.</p>
                    )}
                    {groups.map((group, gIdx) => (
                        <div key={group.id} className="border border-border rounded-lg p-4 space-y-3 bg-muted/10">
                            <div className="flex gap-2 items-start">
                                <div className="flex-1">
                                    <label className="text-[10px] text-muted-foreground font-bold uppercase block mb-1">
                                        Group name
                                    </label>
                                    <input
                                        type="text"
                                        value={group.name}
                                        onChange={(e) => setGroups((prev) => prev.map((g, i) => (
                                            i === gIdx ? { ...g, name: e.target.value } : g
                                        )))}
                                        className="w-full p-2 border border-input rounded bg-background text-sm"
                                        placeholder="e.g. High End"
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setGroups((prev) => prev.filter((_, i) => i !== gIdx))}
                                    className="text-red-500 px-2 pt-6"
                                >
                                    ✕
                                </button>
                            </div>
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-[10px] text-muted-foreground font-bold uppercase">
                                        Categories
                                    </label>
                                    <button
                                        type="button"
                                        onClick={() => setGroups((prev) => prev.map((g, i) => (
                                            i === gIdx
                                                ? { ...g, categories: [...g.categories, { category: '' }] }
                                                : g
                                        )))}
                                        className="text-xs px-2 py-0.5 border border-input rounded hover:bg-muted"
                                    >
                                        Add category
                                    </button>
                                </div>
                                {group.categories.map((cat, cIdx) => (
                                    <div key={cIdx} className="flex gap-2 items-center">
                                        <div className="flex-1">
                                            {categoryInput(cat.category, (v) => {
                                                setGroups((prev) => prev.map((g, i) => {
                                                    if (i !== gIdx) return g;
                                                    const categories = g.categories.map((c, j) => (
                                                        j === cIdx ? { category: v } : c
                                                    ));
                                                    return { ...g, categories };
                                                }));
                                            })}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setGroups((prev) => prev.map((g, i) => (
                                                i === gIdx
                                                    ? { ...g, categories: g.categories.filter((_, j) => j !== cIdx) }
                                                    : g
                                            )))}
                                            className="text-red-500 px-2"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <div className="flex flex-wrap gap-2 items-center">
            <button
                type="button"
                onClick={handleSave}
                disabled={status === 'saving' || !user}
                className="bg-primary text-primary-foreground px-4 py-2 rounded hover:opacity-90 font-medium disabled:opacity-50"
            >
                {status === 'saving' ? 'Saving...' : 'Save race defaults'}
            </button>
            <button
                type="button"
                disabled={!user || enforcing}
                onClick={() => { void handlePreviewEnforce(); }}
                className="px-4 py-2 rounded border border-border text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
                {enforcing ? 'Working…' : 'Preview enforce'}
            </button>
            <button
                type="button"
                disabled={!user || enforcing || status === 'saving'}
                onClick={() => { void handleSaveAndEnforce(); }}
                className="px-4 py-2 rounded border border-border text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
                Save and enforce
            </button>
            </div>
            {enforcePreview && (
                <div className="space-y-2">
                    {(enforcePreview as { coverage?: { ok?: boolean; missing?: string[]; duplicated?: string[] } }).coverage?.ok === false && (
                        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                            Every liga category must appear in exactly one template group
                            {((enforcePreview as { coverage?: { missing?: string[] } }).coverage?.missing || []).length
                                ? ` — missing: ${(enforcePreview as { coverage: { missing: string[] } }).coverage.missing.join(', ')}`
                                : ''}
                            {((enforcePreview as { coverage?: { duplicated?: string[] } }).coverage?.duplicated || []).length
                                ? ` — duplicated: ${(enforcePreview as { coverage: { duplicated: string[] } }).coverage.duplicated.join(', ')}`
                                : ''}
                            .
                        </p>
                    )}
                    {(enforcePreview as { races?: { wouldDropEventId?: boolean }[] }).races?.some((r) => r.wouldDropEventId) && (
                        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                            Group rename/mismatch would drop one or more event IDs. Confirm before enforce.
                        </p>
                    )}
                    {(enforcePreview as { races?: { wouldDropGroupsWithSprints?: string[] }[] }).races?.some(
                        (r) => (r.wouldDropGroupsWithSprints || []).length > 0,
                    ) && (
                        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                            One or more race groups would be removed. Category sprints stay with the category name.
                        </p>
                    )}
                <pre className="text-xs overflow-auto max-h-48 bg-muted/30 p-2 rounded border border-border">
                    {JSON.stringify(
                        {
                            coverage: (enforcePreview as { coverage?: unknown }).coverage,
                            races: (enforcePreview as { races?: unknown }).races,
                            skippedResults: (enforcePreview as { skippedResults?: unknown }).skippedResults,
                        },
                        null,
                        2,
                    )}
                </pre>
                </div>
            )}
        </div>
    );
}
