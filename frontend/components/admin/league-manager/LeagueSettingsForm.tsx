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
} from '@/lib/seasonPointsDefaults';

interface LeagueSettingsFormProps {
    user: User | null;
    settings: LeagueSettings;
    status: LoadingStatus;
    setStatus: (status: LoadingStatus) => void;
}

function tableToByPlaceStr(table: { byPlace?: number[] } | undefined): string {
    return (table?.byPlace || []).join(', ');
}

function tableToRangesStr(table: { ranges?: { from: number; to: number; points: number }[] } | undefined): string {
    return (table?.ranges || [])
        .map(r => `${r.from}-${r.to}:${r.points}`)
        .join(', ');
}

function parseByPlace(str: string): number[] {
    return str.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
}

function parseRanges(str: string): { from: number; to: number; points: number }[] {
    return str
        .split(',')
        .map(part => part.trim())
        .filter(Boolean)
        .map(part => {
            const m = part.match(/^(\d+)\s*-\s*(\d+)\s*:\s*(-?\d+)$/);
            if (!m) return null;
            return { from: parseInt(m[1], 10), to: parseInt(m[2], 10), points: parseInt(m[3], 10) };
        })
        .filter((r): r is { from: number; to: number; points: number } => r !== null);
}

export default function LeagueSettingsForm({
    user,
    settings,
    status,
    setStatus,
}: LeagueSettingsFormProps) {
    const queryClient = useQueryClient();
    const [leagueName, setLeagueName] = useState('');
    const [finishPointsStr, setFinishPointsStr] = useState('');
    const [sprintPointsStr, setSprintPointsStr] = useState('');
    const [leagueRankPointsStr, setLeagueRankPointsStr] = useState('');
    const [bestRacesCount, setBestRacesCount] = useState(5);
    const [seasonBestResultsCount, setSeasonBestResultsCount] = useState(0);
    const [seasonByPlace, setSeasonByPlace] = useState<Record<string, string>>({});
    const [seasonRanges, setSeasonRanges] = useState<Record<string, string>>({});

    // Generator state
    const [genStart, setGenStart] = useState(130);
    const [genEnd, setGenEnd] = useState(1);
    const [genStep, setGenStep] = useState(1);
    const [genTarget, setGenTarget] = useState<'finish' | 'sprint' | 'league'>('finish');

    // Sync with settings prop
    useEffect(() => {
        setLeagueName(settings.name || '');
        setFinishPointsStr((settings.finishPoints || []).join(', '));
        setSprintPointsStr((settings.sprintPoints || []).join(', '));
        setLeagueRankPointsStr((settings.leagueRankPoints || []).join(', '));
        setBestRacesCount(settings.bestRacesCount || 5);
        setSeasonBestResultsCount(settings.seasonBestResultsCount ?? 0);

        const src = settings.seasonRankPoints || DEFAULT_SEASON_RANK_POINTS;
        const byPlace: Record<string, string> = {};
        const ranges: Record<string, string> = {};
        for (const key of SEASON_POINT_TABLE_KEYS) {
            const table = src[key] || DEFAULT_SEASON_RANK_POINTS[key];
            byPlace[key] = tableToByPlaceStr(table);
            ranges[key] = tableToRangesStr(table);
        }
        setSeasonByPlace(byPlace);
        setSeasonRanges(ranges);
    }, [settings]);

    const generatePoints = () => {
        const points: number[] = [];
        if (genStart > genEnd) {
            for (let i = genStart; i >= genEnd; i -= genStep) {
                points.push(i);
            }
        } else {
            for (let i = genStart; i <= genEnd; i += genStep) {
                points.push(i);
            }
        }
        const str = points.join(', ');
        if (genTarget === 'finish') {
            setFinishPointsStr(str);
        } else if (genTarget === 'sprint') {
            setSprintPointsStr(str);
        } else {
            setLeagueRankPointsStr(str);
        }
    };

    const handleSaveSettings = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;
        
        setStatus('saving');
        try {
            const token = await user.getIdToken();
            
            const finishPoints = finishPointsStr.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
            const sprintPoints = sprintPointsStr.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
            const leagueRankPoints = leagueRankPointsStr.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));

            const seasonRankPoints = {} as SeasonRankPoints;
            for (const key of SEASON_POINT_TABLE_KEYS) {
                seasonRankPoints[key] = {
                    byPlace: parseByPlace(seasonByPlace[key] || ''),
                    ranges: parseRanges(seasonRanges[key] || ''),
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
                    finishPoints, 
                    sprintPoints, 
                    leagueRankPoints, 
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
        } catch (e) {
            alert('Error saving settings');
        } finally {
            setStatus('idle');
        }
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <form onSubmit={handleSaveSettings} className="lg:col-span-2 space-y-8">
                <div className="bg-card p-6 rounded-lg shadow border border-border space-y-6">
                    <h2 className="text-xl font-semibold text-card-foreground">Scoring Rules</h2>
                        <div>
                            <label className="block font-medium text-card-foreground mb-2">
                                Finish Points (1st, 2nd, 3rd...)
                            </label>
                            <p className="text-xs text-muted-foreground mb-2">
                                Comma-separated list of points awarded by position.
                            </p>
                            <textarea 
                                value={finishPointsStr}
                                onChange={e => setFinishPointsStr(e.target.value)}
                                className="w-full p-3 border border-input rounded-lg bg-background text-foreground h-24 font-mono text-sm"
                                placeholder="e.g. 100, 95, 90, 85, 80..."
                            />
                        </div>
                        <div>
                            <label className="block font-medium text-card-foreground mb-2">
                                Sprint Points (1st, 2nd, 3rd...)
                            </label>
                            <p className="text-xs text-muted-foreground mb-2">
                                Points awarded for intermediate sprints.
                            </p>
                            <textarea 
                                value={sprintPointsStr}
                                onChange={e => setSprintPointsStr(e.target.value)}
                                className="w-full p-3 border border-input rounded-lg bg-background text-foreground h-24 font-mono text-sm"
                                placeholder="e.g. 10, 9, 8, 7, 6..."
                            />
                        </div>
                        <div>
                            <label className="block font-medium text-card-foreground mb-2">
                                League Rank Points (Optional)
                            </label>
                            <p className="text-xs text-muted-foreground mb-2">
                                If set, league points are awarded based on rank in the race (Finish + Sprint points). 
                                Leave empty to use raw points sum.
                            </p>
                            <textarea 
                                value={leagueRankPointsStr}
                                onChange={e => setLeagueRankPointsStr(e.target.value)}
                                className="w-full p-3 border border-input rounded-lg bg-background text-foreground h-24 font-mono text-sm"
                                placeholder="e.g. 50, 48, 46, 44..."
                            />
                        </div>
                        <div>
                            <label className="block font-medium text-card-foreground mb-2">
                                Number of Counting Races (legacy / event GC tables)
                            </label>
                            <p className="text-xs text-muted-foreground mb-2">
                                Shared league-rank table size for event GC. Per-event best-X is set on each event.
                                Legacy flat seasons also use this count.
                            </p>
                            <input 
                                type="number" 
                                value={bestRacesCount}
                                onChange={e => setBestRacesCount(parseInt(e.target.value) || 5)}
                                className="w-24 p-2 border border-input rounded bg-background text-foreground"
                                min="1"
                            />
                        </div>
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
                                onChange={e => setSeasonBestResultsCount(parseInt(e.target.value, 10) || 0)}
                                className="w-24 p-2 border border-input rounded bg-background text-foreground"
                                min="0"
                            />
                        </div>
                </div>

                <div className="bg-card p-6 rounded-lg shadow border border-border">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                        <div>
                            <h2 className="text-xl font-semibold text-card-foreground">Season prestige points</h2>
                            <p className="text-xs text-muted-foreground mt-1">
                                Place lists are comma-separated. Ranges use <code>from-to:points</code> (e.g. 21-25:50).
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                const byPlace: Record<string, string> = {};
                                const ranges: Record<string, string> = {};
                                for (const key of SEASON_POINT_TABLE_KEYS) {
                                    byPlace[key] = tableToByPlaceStr(DEFAULT_SEASON_RANK_POINTS[key]);
                                    ranges[key] = tableToRangesStr(DEFAULT_SEASON_RANK_POINTS[key]);
                                }
                                setSeasonByPlace(byPlace);
                                setSeasonRanges(ranges);
                            }}
                            className="text-sm px-3 py-1.5 border border-input rounded hover:bg-muted"
                        >
                            Reset to defaults
                        </button>
                    </div>
                    <div className="space-y-6">
                        {SEASON_POINT_TABLE_KEYS.map(key => (
                            <div key={key} className="border border-border rounded-lg p-4 space-y-3">
                                <h3 className="font-medium">{SEASON_POINT_TABLE_LABELS[key]}</h3>
                                <div>
                                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                                        By place (1st, 2nd, …)
                                    </label>
                                    <textarea
                                        value={seasonByPlace[key] || ''}
                                        onChange={e => setSeasonByPlace(prev => ({ ...prev, [key]: e.target.value }))}
                                        className="w-full p-2 border border-input rounded bg-background font-mono text-sm h-20"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                                        Ranges (optional)
                                    </label>
                                    <input
                                        value={seasonRanges[key] || ''}
                                        onChange={e => setSeasonRanges(prev => ({ ...prev, [key]: e.target.value }))}
                                        className="w-full p-2 border border-input rounded bg-background font-mono text-sm"
                                        placeholder="21-25:50, 26-30:40"
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <button
                    type="submit"
                    disabled={status === 'saving'}
                    className="bg-primary text-primary-foreground px-6 py-2 rounded hover:opacity-90 font-medium"
                >
                    {status === 'saving' ? 'Saving...' : 'Save Settings'}
                </button>
            </form>

            {/* Points Generator Tool */}
            <div className="bg-card p-6 rounded-lg shadow border border-border h-fit">
                <h3 className="text-lg font-semibold mb-4 text-card-foreground">Points Generator</h3>
                <div className="space-y-4">
                    <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">Target Field</label>
                        <div className="flex gap-2">
                            <button 
                                type="button"
                                onClick={() => setGenTarget('finish')}
                                className={`flex-1 py-1 px-2 text-sm rounded border ${
                                    genTarget === 'finish' 
                                        ? 'bg-primary text-primary-foreground border-primary' 
                                        : 'bg-background text-foreground border-input'
                                }`}
                            >
                                Finish
                            </button>
                            <button 
                                type="button"
                                onClick={() => setGenTarget('sprint')}
                                className={`flex-1 py-1 px-2 text-sm rounded border ${
                                    genTarget === 'sprint' 
                                        ? 'bg-primary text-primary-foreground border-primary' 
                                        : 'bg-background text-foreground border-input'
                                }`}
                            >
                                Sprint
                            </button>
                            <button 
                                type="button"
                                onClick={() => setGenTarget('league')}
                                className={`flex-1 py-1 px-2 text-sm rounded border ${
                                    genTarget === 'league' 
                                        ? 'bg-primary text-primary-foreground border-primary' 
                                        : 'bg-background text-foreground border-input'
                                }`}
                            >
                                League
                            </button>
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        <div>
                            <label className="block text-xs font-medium text-muted-foreground mb-1">Start</label>
                            <input 
                                type="number" 
                                value={genStart}
                                onChange={e => setGenStart(parseInt(e.target.value))}
                                className="w-full p-2 border border-input rounded bg-background text-foreground text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-muted-foreground mb-1">End</label>
                            <input 
                                type="number" 
                                value={genEnd}
                                onChange={e => setGenEnd(parseInt(e.target.value))}
                                className="w-full p-2 border border-input rounded bg-background text-foreground text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-muted-foreground mb-1">Step</label>
                            <input 
                                type="number" 
                                value={genStep}
                                onChange={e => setGenStep(parseInt(e.target.value))}
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
                </div>
            </div>
        </div>
    );
}
