'use client';

import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import type { LeagueSettings, LoadingStatus } from '@/types/admin';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

interface LeagueSettingsFormProps {
    user: User | null;
    settings: LeagueSettings;
    onSave: (settings: LeagueSettings) => void;
    status: LoadingStatus;
    setStatus: (status: LoadingStatus) => void;
}

export default function LeagueSettingsForm({
    user,
    settings,
    onSave,
    status,
    setStatus,
}: LeagueSettingsFormProps) {
    const [leagueName, setLeagueName] = useState('');
    const [finishPointsStr, setFinishPointsStr] = useState('');
    const [sprintPointsStr, setSprintPointsStr] = useState('');
    const [leagueRankPointsStr, setLeagueRankPointsStr] = useState('');
    const [bestRacesCount, setBestRacesCount] = useState(5);

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
                    bestRacesCount 
                }),
            });
            
            if (res.ok) {
                alert('Settings saved!');
                onSave({ 
                    name: leagueName, 
                    finishPoints, 
                    sprintPoints, 
                    leagueRankPoints, 
                    bestRacesCount 
                });
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
            <div className="lg:col-span-2 space-y-8">
                <div className="bg-card p-6 rounded-lg shadow border border-border">
                    <h2 className="text-xl font-semibold mb-6 text-card-foreground">Scoring Rules</h2>
                    <form onSubmit={handleSaveSettings} className="space-y-6">
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
                                Number of Counting Races
                            </label>
                            <p className="text-xs text-muted-foreground mb-2">
                                How many best results count towards the final league standing.
                            </p>
                            <input 
                                type="number" 
                                value={bestRacesCount}
                                onChange={e => setBestRacesCount(parseInt(e.target.value) || 5)}
                                className="w-24 p-2 border border-input rounded bg-background text-foreground"
                                min="1"
                            />
                        </div>
                        <button 
                            type="submit"
                            disabled={status === 'saving'}
                            className="bg-primary text-primary-foreground px-6 py-2 rounded hover:opacity-90 font-medium"
                        >
                            {status === 'saving' ? 'Saving...' : 'Save Settings'}
                        </button>
                    </form>
                </div>
            </div>

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
