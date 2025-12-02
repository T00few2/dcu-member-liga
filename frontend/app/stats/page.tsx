'use client';

import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { 
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    ScatterChart, Scatter, ZAxis, Cell
} from 'recharts';

// --- Types ---

interface Race {
    id: string;
    name: string;
    date: string;
    routeId: string;
    routeName: string;
    laps: number;
    results?: Record<string, ResultEntry[]>; 
    sprints?: Sprint[];
}

interface Sprint {
    id: string;
    name: string;
    count: number;
    key?: string;
    direction?: string;
}

interface ResultEntry {
    zwiftId: string;
    name: string;
    finishTime: number;
    finishRank: number;
    finishPoints: number;
    sprintPoints: number;
    totalPoints: number;
    sprintDetails?: Record<string, number>;
    // Newly added fields
    sprintData?: Record<string, SprintPerformance>;
    criticalP?: CriticalPower;
}

interface SprintPerformance {
    avgPower: number;
    time: number;
    rank: number;
}

interface CriticalPower {
    criticalP15Seconds: number;
    criticalP1Minute: number;
    criticalP5Minutes: number;
    criticalP20Minutes: number;
}

export default function MyStatsPage() {
    const { user, loading: authLoading, isRegistered } = useAuth();
    const router = useRouter();

    const [races, setRaces] = useState<Race[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedRaceId, setSelectedRaceId] = useState<string>('');
    const [currentUserZwiftId, setCurrentUserZwiftId] = useState<string | null>(null);
    
    // Graph State
    const [sprintXAxis, setSprintXAxis] = useState<'rank' | 'time'>('rank');

    // --- 1. Access Control & Fetch User Details ---
    useEffect(() => {
        if (!authLoading) {
            if (!user) {
                router.push('/');
            } else if (!isRegistered) {
                router.push('/register');
            }
        }
    }, [user, authLoading, isRegistered, router]);

    // --- 2. Fetch Races & User Profile ---
    useEffect(() => {
        const fetchData = async () => {
            if (!user) return;
            try {
                const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
                const token = await user.getIdToken();
                
                // Get User Profile to know ZwiftID
                const profileRes = await fetch(`${apiUrl}/profile`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (profileRes.ok) {
                    const profile = await profileRes.json();
                    setCurrentUserZwiftId(profile.zwiftId?.toString());
                }

                // Get Races
                const racesRes = await fetch(`${apiUrl}/races`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (racesRes.ok) {
                    const data = await racesRes.json();
                    // Filter for races that have results
                    const finishedRaces = (data.races || []).filter((r: Race) => r.results && Object.keys(r.results).length > 0);
                    
                    // Sort by date desc
                    finishedRaces.sort((a: Race, b: Race) => 
                        new Date(b.date).getTime() - new Date(a.date).getTime()
                    );
                    
                    setRaces(finishedRaces);
                    if (finishedRaces.length > 0) {
                        setSelectedRaceId(finishedRaces[0].id);
                    }
                }
            } catch (e) {
                console.error('Error fetching data', e);
            } finally {
                setLoading(false);
            }
        };

        if (user && isRegistered) {
            fetchData();
        }
    }, [user, isRegistered]);

    // --- 3. Derive Data for Views ---

    const selectedRace = useMemo(() => 
        races.find(r => r.id === selectedRaceId), 
    [races, selectedRaceId]);

    // Find which category the user rode in
    const userCategory = useMemo(() => {
        if (!selectedRace?.results || !currentUserZwiftId) return null;
        for (const [cat, riders] of Object.entries(selectedRace.results)) {
            if (riders.some(r => r.zwiftId === currentUserZwiftId)) {
                return cat;
            }
        }
        return null;
    }, [selectedRace, currentUserZwiftId]);

    // Get result entry for user
    const userResult = useMemo(() => {
        if (!selectedRace?.results || !userCategory || !currentUserZwiftId) return null;
        return selectedRace.results[userCategory].find(r => r.zwiftId === currentUserZwiftId);
    }, [selectedRace, userCategory, currentUserZwiftId]);

    // Get all riders in same category for comparison
    const categoryRiders = useMemo(() => {
        if (!selectedRace?.results || !userCategory) return [];
        return selectedRace.results[userCategory];
    }, [selectedRace, userCategory]);


    // --- Helper: Format Time ---
    const formatTime = (ms: number) => {
        if (!ms) return '-';
        const totalSeconds = ms / 1000;
        return totalSeconds.toFixed(1) + 's';
    };

    if (authLoading || loading) {
        return <div className="p-12 text-center text-muted-foreground">Loading your stats...</div>;
    }

    if (!selectedRace) {
        return (
            <div className="max-w-6xl mx-auto px-4 py-8">
                <h1 className="text-3xl font-bold mb-8">My Stats</h1>
                <div className="p-8 bg-muted/20 rounded text-center text-muted-foreground">
                    No finished races found with results.
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto px-4 py-8 pb-24">
            <h1 className="text-3xl font-bold mb-8">My Stats</h1>

            {/* 1. Race Selector */}
            <div className="bg-card border border-border p-6 rounded-lg shadow-sm mb-8">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                        <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                            Select Race
                        </label>
                        <select 
                            value={selectedRaceId}
                            onChange={(e) => setSelectedRaceId(e.target.value)}
                            className="bg-background border border-input rounded px-3 py-2 text-foreground font-medium w-full sm:w-80"
                        >
                            {races.map(r => (
                                <option key={r.id} value={r.id}>
                                    {new Date(r.date).toLocaleDateString()} - {r.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    {userResult ? (
                        <div className="text-right">
                            <div className="text-2xl font-bold text-primary">
                                Rank {userResult.finishRank}
                            </div>
                            <div className="text-sm text-muted-foreground">
                                Cat {userCategory} • {userResult.totalPoints} Pts
                            </div>
                        </div>
                    ) : (
                        <div className="text-right text-muted-foreground italic">
                            You did not participate in this race (or results missing)
                        </div>
                    )}
                </div>
            </div>

            {!userResult ? null : (
                <div className="space-y-12">

                    {/* 2. Power Curve Analysis */}
                    <section>
                        <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
                            <span>💪 Power Curve Comparison</span>
                        </h2>
                        
                        <div className="bg-card border border-border p-6 rounded-lg shadow-sm">
                            <div className="h-[400px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart>
                                        <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                                        <XAxis 
                                            dataKey="name" 
                                            type="category" 
                                            allowDuplicatedCategory={false}
                                            tick={{fontSize: 12}}
                                        />
                                        <YAxis 
                                            label={{ value: 'Watts', angle: -90, position: 'insideLeft' }}
                                            tick={{fontSize: 12}}
                                        />
                                        <Tooltip 
                                            content={({ active, payload, label }) => {
                                                if (active && payload && payload.length) {
                                                    // Filter to only show "Me"
                                                    const myPayload = payload.find(p => p.name === "Me");
                                                    if (!myPayload) return null;

                                                    return (
                                                        <div className="bg-background border border-border p-2 rounded shadow text-sm">
                                                            <p className="font-bold mb-1">{label}</p>
                                                            <p style={{ color: myPayload.color }}>
                                                                My Power: {myPayload.value}w
                                                            </p>
                                                        </div>
                                                    );
                                                }
                                                return null;
                                            }}
                                        />
                                        <Legend 
                                            verticalAlign="top" 
                                            align="right" 
                                        />
                                        
                                        {/* Render Lines for ALL riders in category */}
                                        {categoryRiders.map((rider) => {
                                            if (!rider.criticalP) return null;
                                            
                                            const isMe = rider.zwiftId === currentUserZwiftId;
                                            const data = [
                                                { name: '15s', value: rider.criticalP.criticalP15Seconds },
                                                { name: '1m', value: rider.criticalP.criticalP1Minute },
                                                { name: '5m', value: rider.criticalP.criticalP5Minutes },
                                                { name: '20m', value: rider.criticalP.criticalP20Minutes },
                                            ];

                                            return (
                                                <Line
                                                    key={rider.zwiftId}
                                                    data={data}
                                                    type="monotone"
                                                    dataKey="value"
                                                    stroke={isMe ? '#ff0000' : '#8884d8'}
                                                    strokeWidth={isMe ? 3 : 1}
                                                    strokeOpacity={isMe ? 1 : 0.15} // Low opacity for others
                                                    dot={isMe} // Only show dots for user
                                                    activeDot={{ r: 6 }}
                                                    name={isMe ? "Me" : "Others"}
                                                    legendType={isMe ? 'line' : 'none'} // Hide others from legend
                                                    isAnimationActive={false} // Improve performance with many lines
                                                />
                                            );
                                        })}
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                            <p className="text-sm text-muted-foreground text-center mt-4">
                                Comparing your Critical Power (15s, 1m, 5m, 20m) against all other riders in Category {userCategory}.
                            </p>
                        </div>
                    </section>
                    
                    {/* 3. Sprint Analysis */}
                    <section>
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-2xl font-bold flex items-center gap-2">
                                <span>⚡ Sprint Analysis</span>
                            </h2>
                            
                            <div className="bg-muted/30 p-1 rounded-lg flex text-xs font-medium">
                                <button 
                                    onClick={() => setSprintXAxis('rank')}
                                    className={`px-3 py-1 rounded transition-colors ${sprintXAxis === 'rank' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                                >
                                    By Rank
                                </button>
                                <button 
                                    onClick={() => setSprintXAxis('time')}
                                    className={`px-3 py-1 rounded transition-colors ${sprintXAxis === 'time' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                                >
                                    By Time
                                </button>
                            </div>
                        </div>
                        
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                            {/* A. Sprint Table */}
                            <div className="space-y-6">
                                {(selectedRace.sprints || []).map((sprint) => {
                                    const sprintKey = sprint.key || `${sprint.id}_${sprint.count}`;
                                    const myData = userResult.sprintData?.[sprintKey];
                                    
                                    if (!myData) return null;

                                    return (
                                        <div key={sprintKey} className="bg-card border border-border rounded-lg p-4 shadow-sm">
                                            <div className="flex justify-between items-center mb-3">
                                                <h3 className="font-semibold text-lg">{sprint.name} <span className="text-sm font-normal text-muted-foreground">#{sprint.count}</span></h3>
                                                <div className="px-2 py-1 bg-secondary text-secondary-foreground rounded text-xs font-mono">
                                                    Rank: {myData.rank}
                                                </div>
                                            </div>
                                            
                                            <div className="grid grid-cols-3 gap-4 text-center mb-4">
                                                <div className="bg-muted/30 p-2 rounded">
                                                    <div className="text-xs text-muted-foreground">Time</div>
                                                    <div className="font-mono font-bold">{formatTime(myData.time)}</div>
                                                </div>
                                                <div className="bg-muted/30 p-2 rounded">
                                                    <div className="text-xs text-muted-foreground">Avg Power</div>
                                                    <div className="font-mono font-bold text-orange-500">{myData.avgPower}w</div>
                                                </div>
                                                <div className="bg-muted/30 p-2 rounded">
                                                    <div className="text-xs text-muted-foreground">Points</div>
                                                    <div className="font-mono font-bold">{userResult.sprintDetails?.[sprintKey] || 0}</div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                                {(!userResult.sprintData || Object.keys(userResult.sprintData).length === 0) && (
                                    <div className="text-muted-foreground italic">No sprint data recorded for this race.</div>
                                )}
                            </div>

                            {/* B. Comparison Scatter Charts */}
                            <div className="space-y-8">
                                {(selectedRace.sprints || []).map((sprint) => {
                                    const sprintKey = sprint.key || `${sprint.id}_${sprint.count}`;
                                    const myData = userResult.sprintData?.[sprintKey];

                                    if (!myData) return null;

                                    // Prepare Scatter Data
                                    const scatterData = categoryRiders
                                        .map(rider => {
                                            const sData = rider.sprintData?.[sprintKey];
                                            if (!sData) return null;
                                            const isMe = rider.zwiftId === currentUserZwiftId;
                                            return {
                                                id: rider.zwiftId,
                                                name: rider.name,
                                                time: sData.time / 1000, // seconds
                                                rank: sData.rank,
                                                power: sData.avgPower,
                                                isMe,
                                                color: isMe ? '#ff0000' : '#8884d8',
                                                opacity: isMe ? 1 : 0.3,
                                                size: isMe ? 100 : 40
                                            };
                                        })
                                        .filter(Boolean);

                                    return (
                                        <div key={sprintKey} className="bg-card border border-border rounded-lg p-4 shadow-sm h-[300px]">
                                            <h4 className="text-sm font-semibold text-muted-foreground mb-2 text-center">
                                                {sprint.name} #{sprint.count} Comparison
                                            </h4>
                                            <ResponsiveContainer width="100%" height="100%">
                                                <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                                                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                                                    <XAxis 
                                                        type="number" 
                                                        dataKey={sprintXAxis === 'rank' ? 'rank' : 'time'} 
                                                        name={sprintXAxis === 'rank' ? 'Rank' : 'Time'} 
                                                        unit={sprintXAxis === 'rank' ? '' : 's'}
                                                        domain={['auto', 'auto']}
                                                        tick={{fontSize: 10}}
                                                        label={{ value: sprintXAxis === 'rank' ? 'Rank' : 'Time (s)', position: 'insideBottom', offset: -5, fontSize: 10 }}
                                                    />
                                                    <YAxis 
                                                        type="number" 
                                                        dataKey="power" 
                                                        name="Power" 
                                                        unit="w"
                                                        tick={{fontSize: 10}} 
                                                        label={{ value: 'Power (w)', angle: -90, position: 'insideLeft', style: {textAnchor: 'middle'}, fontSize: 10 }}
                                                    />
                                                    <Tooltip 
                                                        cursor={{ strokeDasharray: '3 3' }}
                                                        content={({ active, payload }) => {
                                                            if (active && payload && payload.length) {
                                                                const data = payload[0].payload;
                                                                return (
                                                                    <div className="bg-background border border-border p-2 rounded shadow text-xs">
                                                                        <p className="font-bold">{data.name}</p>
                                                                        <p>Rank: {data.rank}</p>
                                                                        <p>Time: {data.time.toFixed(2)}s</p>
                                                                        <p>Power: {data.power}w</p>
                                                                    </div>
                                                                );
                                                            }
                                                            return null;
                                                        }}
                                                    />
                                                    <Scatter name="Riders" data={scatterData} fill="#8884d8">
                                                        {scatterData.map((entry, index) => (
                                                            <Cell key={`cell-${index}`} fill={entry!.isMe ? '#ff0000' : '#8884d8'} fillOpacity={entry!.opacity} />
                                                        ))}
                                                    </Scatter>
                                                </ScatterChart>
                                            </ResponsiveContainer>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </section>

                </div>
            )}
        </div>
    );
}
