'use client';

import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { User } from 'firebase/auth';
import type { LeagueSettings, LoadingStatus, SeasonRankPoints } from '@/types/admin';
import { API_URL } from '@/lib/api';
import {
    DEFAULT_SEASON_RANK_POINTS,
    SEASON_POINT_TABLE_KEYS,
    SEASON_POINT_TABLE_LABELS,
    expandAllSeasonTables,
    trimTrailingZeros,
    type SeasonPointTableKey,
} from '@/lib/seasonPointsDefaults';
import PointsPlaceTable from './PointsPlaceTable';

interface LeagueSettingsFormProps {
    user: User | null;
    settings: LeagueSettings;
    status: LoadingStatus;
    setStatus: (status: LoadingStatus) => void;
}

type SettingsSubTab = 'raceDay' | 'season';

type GenTarget =
    | 'finish'
    | 'sprint'
    | 'league'
    | SeasonPointTableKey;

const GEN_TARGETS: { key: GenTarget; label: string; group: 'race' | 'season' }[] = [
    { key: 'finish', label: 'Finish', group: 'race' },
    { key: 'sprint', label: 'Sprint', group: 'race' },
    { key: 'league', label: 'League rank', group: 'race' },
    { key: 'tour_overall', label: 'Tour samlet', group: 'season' },
    { key: 'tour_stage', label: 'Tour-etape', group: 'season' },
    { key: 'monument', label: 'Monument', group: 'season' },
    { key: 'wt_classic', label: 'WT-klassiker', group: 'season' },
];

function emptySeasonColumns(): Record<SeasonPointTableKey, number[]> {
    return {
        tour_overall: [],
        tour_stage: [],
        monument: [],
        wt_classic: [],
    };
}

function setColumnValue(values: number[], placeIndex: number, value: number | null): number[] {
    const next = [...values];
    while (next.length <= placeIndex) next.push(0);
    if (value == null) {
        next[placeIndex] = 0;
    } else {
        next[placeIndex] = value;
    }
    return next;
}

function padToLength(values: number[], length: number): number[] {
    if (values.length >= length) return values;
    return [...values, ...Array(length - values.length).fill(0)];
}

export default function LeagueSettingsForm({
    user,
    settings,
    status,
    setStatus,
}: LeagueSettingsFormProps) {
    const queryClient = useQueryClient();
    const [leagueName, setLeagueName] = useState('');
    const [subTab, setSubTab] = useState<SettingsSubTab>('raceDay');

    const [finishPoints, setFinishPoints] = useState<number[]>([]);
    const [sprintPoints, setSprintPoints] = useState<number[]>([]);
    const [leagueRankPoints, setLeagueRankPoints] = useState<number[]>([]);
    const [bestRacesCount, setBestRacesCount] = useState(5);
    const [seasonBestResultsCount, setSeasonBestResultsCount] = useState(0);
    const [seasonColumns, setSeasonColumns] = useState<Record<SeasonPointTableKey, number[]>>(emptySeasonColumns);

    const [genStart, setGenStart] = useState(130);
    const [genEnd, setGenEnd] = useState(1);
    const [genStep, setGenStep] = useState(1);
    const [genTarget, setGenTarget] = useState<GenTarget>('finish');

    useEffect(() => {
        setLeagueName(settings.name || '');
        setFinishPoints([...(settings.finishPoints || [])]);
        setSprintPoints([...(settings.sprintPoints || [])]);
        setLeagueRankPoints([...(settings.leagueRankPoints || [])]);
        setBestRacesCount(settings.bestRacesCount || 5);
        setSeasonBestResultsCount(settings.seasonBestResultsCount ?? 0);
        setSeasonColumns(expandAllSeasonTables(settings.seasonRankPoints || DEFAULT_SEASON_RANK_POINTS));
    }, [settings]);

    useEffect(() => {
        if (subTab === 'raceDay' && (genTarget === 'tour_overall' || genTarget === 'tour_stage' || genTarget === 'monument' || genTarget === 'wt_classic')) {
            setGenTarget('finish');
        } else if (subTab === 'season' && (genTarget === 'finish' || genTarget === 'sprint' || genTarget === 'league')) {
            setGenTarget('tour_overall');
        }
    }, [subTab]); // eslint-disable-line react-hooks/exhaustive-deps -- only nudge default when tab changes

    const applyGenerated = (points: number[]) => {
        if (genTarget === 'finish') setFinishPoints(points);
        else if (genTarget === 'sprint') setSprintPoints(points);
        else if (genTarget === 'league') setLeagueRankPoints(points);
        else {
            setSeasonColumns((prev) => {
                const rowCount = Math.max(
                    points.length,
                    ...SEASON_POINT_TABLE_KEYS.map((k) => prev[k].length),
                );
                const next = { ...prev };
                for (const key of SEASON_POINT_TABLE_KEYS) {
                    next[key] = padToLength(prev[key], rowCount);
                }
                next[genTarget] = padToLength(points, rowCount);
                return next;
            });
        }
    };

    const generatePoints = () => {
        const step = Math.abs(genStep) || 1;
        const points: number[] = [];
        if (genStart > genEnd) {
            for (let i = genStart; i >= genEnd; i -= step) points.push(i);
        } else {
            for (let i = genStart; i <= genEnd; i += step) points.push(i);
        }
        applyGenerated(points);
    };

    const onRaceDayCellChange = (columnKey: string, placeIndex: number, value: number | null) => {
        if (columnKey === 'finish') setFinishPoints((prev) => setColumnValue(prev, placeIndex, value));
        else if (columnKey === 'sprint') setSprintPoints((prev) => setColumnValue(prev, placeIndex, value));
        else if (columnKey === 'league') setLeagueRankPoints((prev) => setColumnValue(prev, placeIndex, value));
    };

    const addRaceDayPlace = () => {
        const len = Math.max(finishPoints.length, sprintPoints.length, leagueRankPoints.length) + 1;
        setFinishPoints((prev) => padToLength(prev, len));
        setSprintPoints((prev) => padToLength(prev, len));
        setLeagueRankPoints((prev) => padToLength(prev, len));
    };

    const onSeasonCellChange = (columnKey: string, placeIndex: number, value: number | null) => {
        const key = columnKey as SeasonPointTableKey;
        setSeasonColumns((prev) => ({
            ...prev,
            [key]: setColumnValue(prev[key], placeIndex, value),
        }));
    };

    const addSeasonPlace = () => {
        setSeasonColumns((prev) => {
            const len = Math.max(...SEASON_POINT_TABLE_KEYS.map((k) => prev[k].length)) + 1;
            const next = { ...prev };
            for (const key of SEASON_POINT_TABLE_KEYS) {
                next[key] = padToLength(prev[key], len);
            }
            return next;
        });
    };

    const resetSeasonDefaults = () => {
        setSeasonColumns(expandAllSeasonTables(DEFAULT_SEASON_RANK_POINTS));
    };

    const handleSaveSettings = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;

        setStatus('saving');
        try {
            const token = await user.getIdToken();

            const seasonRankPoints = {} as SeasonRankPoints;
            for (const key of SEASON_POINT_TABLE_KEYS) {
                seasonRankPoints[key] = {
                    byPlace: trimTrailingZeros(seasonColumns[key] || []),
                    ranges: [],
                };
            }

            const res = await fetch(`${API_URL}/league/settings`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                    name: leagueName,
                    finishPoints: trimTrailingZeros(finishPoints),
                    sprintPoints: trimTrailingZeros(sprintPoints),
                    leagueRankPoints: trimTrailingZeros(leagueRankPoints),
                    bestRacesCount,
                    seasonBestResultsCount,
                    seasonRankPoints,
                }),
            });

            if (res.ok) {
                alert('Settings saved!');
                await queryClient.invalidateQueries({ queryKey: ['league', 'settings'] });
                await queryClient.invalidateQueries({ queryKey: ['league', 'standings'] });
            } else {
                alert('Failed to save settings');
            }
        } catch {
            alert('Error saving settings');
        } finally {
            setStatus('idle');
        }
    };

    const raceDayColumns = [
        { key: 'finish', label: 'Finish', values: finishPoints },
        { key: 'sprint', label: 'Sprint', values: sprintPoints },
        { key: 'league', label: 'League rank', values: leagueRankPoints },
    ];

    const seasonTableColumns = SEASON_POINT_TABLE_KEYS.map((key) => ({
        key,
        label: SEASON_POINT_TABLE_LABELS[key],
        values: seasonColumns[key] || [],
    }));

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <form onSubmit={handleSaveSettings} className="lg:col-span-2 space-y-6">
                <div className="bg-card p-6 rounded-lg shadow border border-border space-y-4">
                    <div>
                        <label className="block font-medium text-card-foreground mb-2">League name</label>
                        <input
                            type="text"
                            value={leagueName}
                            onChange={(e) => setLeagueName(e.target.value)}
                            className="w-full max-w-md p-2 border border-input rounded bg-background text-foreground"
                        />
                    </div>

                    <div className="flex gap-2 border-b border-border">
                        <button
                            type="button"
                            onClick={() => setSubTab('raceDay')}
                            className={`pb-2 px-4 text-sm font-medium transition ${
                                subTab === 'raceDay'
                                    ? 'text-primary border-b-2 border-primary'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            Race day
                        </button>
                        <button
                            type="button"
                            onClick={() => setSubTab('season')}
                            className={`pb-2 px-4 text-sm font-medium transition ${
                                subTab === 'season'
                                    ? 'text-primary border-b-2 border-primary'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            Season
                        </button>
                    </div>

                    {subTab === 'raceDay' && (
                        <div className="space-y-4">
                            <div>
                                <h2 className="text-lg font-semibold text-card-foreground">Race-day points</h2>
                                <p className="text-xs text-muted-foreground mt-1">
                                    Finish and sprint feed in-race scoring. League rank maps race order to event GC points
                                    (leave empty to use raw finish+sprint totals).
                                </p>
                            </div>
                            <PointsPlaceTable
                                columns={raceDayColumns}
                                onChange={onRaceDayCellChange}
                                onAddPlace={addRaceDayPlace}
                            />
                            <div>
                                <label className="block font-medium text-card-foreground mb-2">
                                    Number of counting races (legacy / event GC)
                                </label>
                                <p className="text-xs text-muted-foreground mb-2">
                                    Shared default for event GC best-X. Per-event overrides live on each event.
                                </p>
                                <input
                                    type="number"
                                    value={bestRacesCount}
                                    onChange={(e) => setBestRacesCount(parseInt(e.target.value, 10) || 5)}
                                    className="w-24 p-2 border border-input rounded bg-background text-foreground"
                                    min={1}
                                />
                            </div>
                        </div>
                    )}

                    {subTab === 'season' && (
                        <div className="space-y-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <h2 className="text-lg font-semibold text-card-foreground">Season prestige points</h2>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        One row per place. Ranges from settings are expanded into individual places for editing.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={resetSeasonDefaults}
                                    className="text-sm px-3 py-1.5 border border-input rounded hover:bg-muted"
                                >
                                    Reset to defaults
                                </button>
                            </div>
                            <PointsPlaceTable
                                columns={seasonTableColumns}
                                onChange={onSeasonCellChange}
                                onAddPlace={addSeasonPlace}
                            />
                            <div>
                                <label className="block font-medium text-card-foreground mb-2">
                                    Season best results count
                                </label>
                                <p className="text-xs text-muted-foreground mb-2">
                                    How many best prestige lines count in season standings. Use 0 to count all.
                                </p>
                                <input
                                    type="number"
                                    value={seasonBestResultsCount}
                                    onChange={(e) => setSeasonBestResultsCount(parseInt(e.target.value, 10) || 0)}
                                    className="w-24 p-2 border border-input rounded bg-background text-foreground"
                                    min={0}
                                />
                            </div>
                        </div>
                    )}
                </div>

                <button
                    type="submit"
                    disabled={status === 'saving'}
                    className="bg-primary text-primary-foreground px-6 py-2 rounded hover:opacity-90 font-medium"
                >
                    {status === 'saving' ? 'Saving...' : 'Save Settings'}
                </button>
            </form>

            <div className="bg-card p-6 rounded-lg shadow border border-border h-fit lg:sticky lg:top-4">
                <h3 className="text-lg font-semibold mb-4 text-card-foreground">Points Generator</h3>
                <div className="space-y-4">
                    <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">Target column</label>
                        <select
                            value={genTarget}
                            onChange={(e) => setGenTarget(e.target.value as GenTarget)}
                            className="w-full p-2 border border-input rounded bg-background text-foreground text-sm"
                        >
                            <optgroup label="Race day">
                                {GEN_TARGETS.filter((t) => t.group === 'race').map((t) => (
                                    <option key={t.key} value={t.key}>{t.label}</option>
                                ))}
                            </optgroup>
                            <optgroup label="Season">
                                {GEN_TARGETS.filter((t) => t.group === 'season').map((t) => (
                                    <option key={t.key} value={t.key}>{t.label}</option>
                                ))}
                            </optgroup>
                        </select>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        <div>
                            <label className="block text-xs font-medium text-muted-foreground mb-1">Start</label>
                            <input
                                type="number"
                                value={genStart}
                                onChange={(e) => setGenStart(parseInt(e.target.value, 10))}
                                className="w-full p-2 border border-input rounded bg-background text-foreground text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-muted-foreground mb-1">End</label>
                            <input
                                type="number"
                                value={genEnd}
                                onChange={(e) => setGenEnd(parseInt(e.target.value, 10))}
                                className="w-full p-2 border border-input rounded bg-background text-foreground text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-muted-foreground mb-1">Step</label>
                            <input
                                type="number"
                                value={genStep}
                                onChange={(e) => setGenStep(parseInt(e.target.value, 10))}
                                className="w-full p-2 border border-input rounded bg-background text-foreground text-sm"
                            />
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={generatePoints}
                        className="w-full bg-secondary text-secondary-foreground py-2 rounded hover:opacity-90 font-medium text-sm"
                    >
                        Generate & Fill
                    </button>
                    <p className="text-xs text-muted-foreground">
                        Works for any column on either tab. Switching tabs nudges the default target but you can pick any column anytime.
                    </p>
                </div>
            </div>
        </div>
    );
}
