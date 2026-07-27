'use client';

import { useState, useEffect, useCallback } from 'react';
import { User } from 'firebase/auth';
import type { Race, LoadingStatus } from '@/types/admin';

import { API_URL } from '@/lib/api';

interface TestDataPanelProps {
    user: User | null;
    races: Race[];
    status: LoadingStatus;
    setStatus: (status: LoadingStatus) => void;
    onRacesChanged?: () => void;
}

function raceCategoryLabels(race: Race): string[] {
    const cats = new Set<string>();
    if (race.eventMode === 'grouped' && race.raceGroups?.length) {
        race.raceGroups.forEach(group => {
            group.categories?.forEach(cfg => {
                if (cfg.category) cats.add(cfg.category);
            });
        });
    } else if (race.eventMode === 'multi' && race.eventConfiguration?.length) {
        race.eventConfiguration.forEach(cfg => {
            if (cfg.customCategory) cats.add(cfg.customCategory);
        });
    } else if (race.singleModeCategories?.length) {
        race.singleModeCategories.forEach(cfg => {
            if (cfg.category) cats.add(cfg.category);
        });
    } else if (race.eventConfiguration?.length) {
        race.eventConfiguration.forEach(cfg => {
            if (cfg.customCategory) cats.add(cfg.customCategory);
        });
    }
    if (cats.size === 0) {
        return ['A', 'B', 'C', 'D', 'E'];
    }
    return Array.from(cats).sort();
}

export default function TestDataPanel({
    user,
    races,
    status,
    setStatus,
    onRacesChanged,
}: TestDataPanelProps) {
    const [registeredRiderCount, setRegisteredRiderCount] = useState(0);
    const [testParticipantCount, setTestParticipantCount] = useState(0);
    const [participantsToGenerate, setParticipantsToGenerate] = useState(20);
    const [selectedTestRaces, setSelectedTestRaces] = useState<string[]>([]);
    const [testProgress, setTestProgress] = useState(100);
    const [testCategoryRiders, setTestCategoryRiders] = useState<Record<string, number>>({});
    const [finalizeAfterGenerate, setFinalizeAfterGenerate] = useState(true);

    useEffect(() => {
        if (user) {
            fetchSeedStats();
        }
    }, [user]);

    useEffect(() => {
        initTestCategoryRiders();
    }, [selectedTestRaces, races]);

    useEffect(() => {
        if (testProgress < 100) {
            setFinalizeAfterGenerate(false);
        }
    }, [testProgress]);

    const fetchSeedStats = async () => {
        if (!user) return;
        try {
            const token = await user.getIdToken();
            const res = await fetch(`${API_URL}/admin/seed/stats`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (res.ok) {
                const data = await res.json();
                setRegisteredRiderCount(data.registeredRiderCount || 0);
                setTestParticipantCount(data.testParticipantCount || 0);
            }
        } catch (e) {
            console.error('Error fetching test stats:', e);
        }
    };

    const getTestCategories = useCallback((): string[] => {
        if (selectedTestRaces.length === 0) return ['A', 'B', 'C', 'D', 'E'];

        const allCategories = new Set<string>();
        for (const raceId of selectedTestRaces) {
            const race = races.find(r => r.id === raceId);
            if (!race) continue;
            raceCategoryLabels(race).forEach(c => allCategories.add(c));
        }
        return Array.from(allCategories).sort();
    }, [selectedTestRaces, races]);

    const initTestCategoryRiders = useCallback(() => {
        const cats = getTestCategories();
        const newRiders: Record<string, number> = {};
        cats.forEach(cat => {
            newRiders[cat] = testCategoryRiders[cat] ?? 5;
        });
        setTestCategoryRiders(newRiders);
    }, [getTestCategories, testCategoryRiders]);

    const handleGenerateParticipants = async (count: number = 20) => {
        if (!user) return;
        setStatus('seeding');
        try {
            const token = await user.getIdToken();
            const res = await fetch(`${API_URL}/admin/seed/participants`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ count }),
            });

            if (res.ok) {
                const data = await res.json();
                alert(data.message);
                fetchSeedStats();
            } else {
                const data = await res.json();
                alert(`Failed: ${data.message}`);
            }
        } catch (e) {
            alert('Error generating participants');
        } finally {
            setStatus('idle');
        }
    };

    const handleClearParticipants = async () => {
        if (!user || !confirm('Delete all fake test participants? (Real signups are not deleted.)')) return;
        setStatus('seeding');
        try {
            const token = await user.getIdToken();
            const res = await fetch(`${API_URL}/admin/seed/participants`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` },
            });

            if (res.ok) {
                const data = await res.json();
                alert(data.message);
                fetchSeedStats();
            } else {
                const data = await res.json();
                alert(`Failed: ${data.message}`);
            }
        } catch (e) {
            alert('Error clearing participants');
        } finally {
            setStatus('idle');
        }
    };

    const handleGenerateResults = async () => {
        if (!user || selectedTestRaces.length === 0) {
            alert('Please select at least one race');
            return;
        }
        setStatus('seeding');
        try {
            const token = await user.getIdToken();
            const finalize = testProgress >= 100 && finalizeAfterGenerate;
            const res = await fetch(`${API_URL}/admin/seed/results`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    raceIds: selectedTestRaces,
                    progress: testProgress,
                    categoryRiders: testCategoryRiders,
                    finalize,
                }),
            });

            if (res.ok) {
                const data = await res.json();
                alert(data.message);
                onRacesChanged?.();
            } else {
                const data = await res.json();
                alert(`Failed: ${data.message}`);
            }
        } catch (e) {
            alert('Error generating results');
        } finally {
            setStatus('idle');
        }
    };

    const handleClearResults = async (clearAll: boolean = false) => {
        const raceIds = clearAll ? [] : selectedTestRaces;
        const msg = clearAll
            ? 'Clear seeded results from ALL races marked as seed? (Real Zwift results are never cleared.)'
            : `Clear seeded results from ${selectedTestRaces.length} selected race(s)? (Only races with resultsSource=seed are cleared.)`;

        if (!user || !confirm(msg)) return;

        setStatus('seeding');
        try {
            const token = await user.getIdToken();
            const res = await fetch(`${API_URL}/admin/seed/results`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ raceIds }),
            });

            if (res.ok) {
                const data = await res.json();
                alert(data.message);
                onRacesChanged?.();
            } else {
                const data = await res.json();
                alert(`Failed: ${data.message}`);
            }
        } catch (e) {
            alert('Error clearing results');
        } finally {
            setStatus('idle');
        }
    };

    const canFinalize = testProgress >= 100;

    return (
        <div className="max-w-4xl">
            <div className="bg-card p-6 rounded-lg shadow border border-border mb-8">
                <h2 className="text-xl font-semibold mb-2 text-card-foreground">Test Data Generator</h2>
                <p className="text-sm text-muted-foreground mb-6">
                    Builds fake Zwift finishers from your <span className="font-medium text-foreground">registered signups</span>
                    {' '}(by liga category). Points, ranks, event GC, and season standings use production scoring.
                    Seeded races are marked <span className="font-medium text-foreground">resultsSource=seed</span> and
                    each result row has <span className="font-medium text-foreground">isTestData</span> — user profiles are not changed.
                </p>

                <div className="mb-8 pb-8 border-b border-border">
                    <h3 className="text-lg font-semibold text-card-foreground mb-2">Rider pool</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                        Using <span className="font-bold text-foreground text-lg">{registeredRiderCount}</span> registered riders
                        {registeredRiderCount === 0 && (
                            <span className="text-destructive"> — generate results will fail until someone has completed registration</span>
                        )}
                    </p>

                    <details className="text-sm">
                        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                            Optional: fake test participants ({testParticipantCount} in DB)
                        </summary>
                        <p className="text-muted-foreground mt-2 mb-3">
                            Only needed if you want extra synthetic users. Clear never deletes real signups.
                        </p>
                        <div className="flex gap-3 flex-wrap items-center">
                            <div className="flex items-center gap-2">
                                <input
                                    type="number"
                                    min="1"
                                    max="500"
                                    value={participantsToGenerate}
                                    onChange={(e) => setParticipantsToGenerate(Math.max(1, Math.min(500, parseInt(e.target.value) || 1)))}
                                    className="w-20 px-3 py-2 border border-input rounded-lg bg-background text-foreground"
                                />
                                <button
                                    type="button"
                                    onClick={() => handleGenerateParticipants(participantsToGenerate)}
                                    disabled={status === 'seeding'}
                                    className="bg-primary text-primary-foreground px-4 py-2 rounded hover:opacity-90 font-medium disabled:opacity-50"
                                >
                                    {status === 'seeding' ? 'Working...' : 'Generate Fake Participants'}
                                </button>
                            </div>
                            <button
                                type="button"
                                onClick={handleClearParticipants}
                                disabled={status === 'seeding' || testParticipantCount === 0}
                                className="bg-destructive text-destructive-foreground px-4 py-2 rounded hover:opacity-90 font-medium disabled:opacity-50"
                            >
                                Clear Fake Participants
                            </button>
                        </div>
                    </details>
                </div>

                <div>
                    <h3 className="text-lg font-semibold text-card-foreground mb-4">Test Results</h3>

                    <div className="mb-6">
                        <label className="block text-sm font-medium text-card-foreground mb-2">
                            Select Races to Generate Results For
                        </label>
                        <div className="max-h-48 overflow-y-auto border border-input rounded-lg bg-background p-3 space-y-2">
                            {races.map(race => (
                                <label
                                    key={race.id}
                                    className="flex items-center gap-3 cursor-pointer hover:bg-muted/50 p-2 rounded-md transition"
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedTestRaces.includes(race.id)}
                                        onChange={(e) => {
                                            if (e.target.checked) {
                                                setSelectedTestRaces([...selectedTestRaces, race.id]);
                                            } else {
                                                setSelectedTestRaces(selectedTestRaces.filter(id => id !== race.id));
                                            }
                                        }}
                                        className="w-4 h-4 rounded border-input text-primary focus:ring-primary"
                                    />
                                    <span className="text-sm font-medium text-foreground">{race.name}</span>
                                    {race.stageRaceId && (
                                        <span className="text-xs text-muted-foreground">event</span>
                                    )}
                                    {race.resultsSource === 'seed' && (
                                        <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                                            seeded
                                        </span>
                                    )}
                                    <span className="text-xs text-muted-foreground ml-auto">
                                        {new Date(race.date).toLocaleDateString()}
                                    </span>
                                </label>
                            ))}
                            {races.length === 0 && (
                                <p className="text-sm text-muted-foreground italic p-4 text-center">
                                    No races configured. Create races in the Races tab first.
                                </p>
                            )}
                        </div>
                        <div className="flex gap-4 mt-3">
                            <button
                                type="button"
                                onClick={() => setSelectedTestRaces(races.map(r => r.id))}
                                className="text-sm text-primary hover:text-primary/80 font-medium"
                            >
                                Select All
                            </button>
                            <button
                                type="button"
                                onClick={() => setSelectedTestRaces([])}
                                className="text-sm text-muted-foreground hover:text-foreground"
                            >
                                Select None
                            </button>
                            <span className="text-sm text-muted-foreground ml-auto">
                                {selectedTestRaces.length} race(s) selected
                            </span>
                        </div>
                    </div>

                    {selectedTestRaces.length > 0 && (
                        <div className="mb-6 p-4 bg-muted/30 rounded-lg border border-border">
                            <label className="block text-sm font-medium text-card-foreground mb-3">
                                Riders per Category
                            </label>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                                {getTestCategories().map(cat => (
                                    <div key={cat} className="flex flex-col">
                                        <label className="text-xs font-medium text-muted-foreground mb-1 truncate" title={cat}>
                                            {cat}
                                        </label>
                                        <input
                                            type="number"
                                            min="0"
                                            max="50"
                                            value={testCategoryRiders[cat] ?? 5}
                                            onChange={(e) => setTestCategoryRiders({
                                                ...testCategoryRiders,
                                                [cat]: parseInt(e.target.value) || 0,
                                            })}
                                            className="w-full p-2 border border-input rounded bg-background text-foreground text-sm text-center"
                                        />
                                    </div>
                                ))}
                            </div>
                            <p className="text-sm text-muted-foreground mt-3">
                                Total: <span className="font-bold text-foreground">
                                    {Object.values(testCategoryRiders).reduce((a, b) => a + b, 0)}
                                </span> riders per race
                            </p>
                        </div>
                    )}

                    {selectedTestRaces.length > 0 && (
                        <div className="mb-6 p-4 bg-muted/30 rounded-lg border border-border">
                            <label className="block text-sm font-medium text-card-foreground mb-3">
                                Race Progress: <span className="font-bold text-primary text-lg">{testProgress}%</span>
                            </label>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                step="10"
                                value={testProgress}
                                onChange={(e) => setTestProgress(parseInt(e.target.value))}
                                className="w-full h-3 bg-muted rounded-lg appearance-none cursor-pointer"
                            />
                            <div className="flex justify-between text-xs text-muted-foreground mt-2">
                                <span>0% - Empty</span>
                                <span>50% - Mid-race</span>
                                <span>100% - Complete</span>
                            </div>
                            <p className="text-sm text-muted-foreground mt-3 p-3 bg-background rounded border border-border">
                                {testProgress === 0 && "Empty board — riders listed with no finish times or segment efforts"}
                                {testProgress > 0 && testProgress < 50 && "Early race — some segment efforts, few or no finishers (provisional)"}
                                {testProgress >= 50 && testProgress < 100 && `Mid-race — ~${testProgress}% finishers, partial segment efforts (provisional)`}
                                {testProgress === 100 && "Complete — almost all riders finished; production scoring fills points and ranks"}
                            </p>

                            <label className={`mt-4 flex items-start gap-3 ${canFinalize ? 'cursor-pointer' : 'opacity-60'}`}>
                                <input
                                    type="checkbox"
                                    className="mt-1"
                                    checked={canFinalize && finalizeAfterGenerate}
                                    disabled={!canFinalize}
                                    onChange={(e) => setFinalizeAfterGenerate(e.target.checked)}
                                />
                                <span className="text-sm text-card-foreground">
                                    <span className="font-medium">Finalize after generate</span>
                                    <span className="block text-muted-foreground text-xs mt-0.5">
                                        {canFinalize
                                            ? 'Sets resultsPhase to finalized so season standings and event GC update (same as real finalize).'
                                            : 'Disabled while progress is under 100% (always provisional).'}
                                    </span>
                                </span>
                            </label>
                        </div>
                    )}

                    <div className="flex gap-3 flex-wrap pt-4 border-t border-border">
                        <button
                            type="button"
                            onClick={handleGenerateResults}
                            disabled={status === 'seeding' || selectedTestRaces.length === 0 || registeredRiderCount === 0}
                            className="bg-green-600 text-white px-5 py-2.5 rounded hover:bg-green-500 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {status === 'seeding' ? 'Generating...' : 'Generate Results'}
                        </button>
                        <button
                            type="button"
                            onClick={() => handleClearResults(false)}
                            disabled={status === 'seeding' || selectedTestRaces.length === 0}
                            className="bg-orange-600 text-white px-5 py-2.5 rounded hover:bg-orange-500 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Clear Selected Seeded Results
                        </button>
                        <button
                            type="button"
                            onClick={() => handleClearResults(true)}
                            disabled={status === 'seeding'}
                            className="bg-destructive text-destructive-foreground px-5 py-2.5 rounded hover:opacity-90 font-medium disabled:opacity-50"
                        >
                            Clear All Seeded Results
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
