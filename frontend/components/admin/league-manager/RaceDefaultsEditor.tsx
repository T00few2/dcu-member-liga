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

    const handleSave = async () => {
        if (!user) return;
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
                return;
            }
            onMessage?.('Race defaults saved');
            await queryClient.invalidateQueries({ queryKey: ['league', 'settings'] });
        } catch {
            onMessage?.('Error saving race defaults');
        } finally {
            setStatus('idle');
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
                    you fill Zwift event IDs (and route/sprints) per race. Does not change existing races.
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

            <button
                type="button"
                onClick={handleSave}
                disabled={status === 'saving' || !user}
                className="bg-primary text-primary-foreground px-4 py-2 rounded hover:opacity-90 font-medium disabled:opacity-50"
            >
                {status === 'saving' ? 'Saving...' : 'Save race defaults'}
            </button>
        </div>
    );
}
