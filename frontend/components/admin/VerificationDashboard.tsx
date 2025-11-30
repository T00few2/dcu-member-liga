'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';

interface Participant {
    name: string;
    eLicense: string;
    zwiftId: string;
    category: string;
    ftp: string;
    rating: string;
    stravaKms: string;
}

interface ZwiftPowerResult {
    date: string;
    event_title: string;
    avg_watts: number;
    avg_hr: number;
    wkg: number;
    category: string;
}

interface StravaActivity {
    id: number;
    name: string;
    date: string;
    distance: number; // meters
    moving_time: number; // seconds
    average_watts?: number;
    average_heartrate?: number;
    suffer_score?: number;
}

export default function VerificationDashboard() {
    const { user } = useAuth();
    const [search, setSearch] = useState('');
    const [participants, setParticipants] = useState<Participant[]>([]);
    const [loadingList, setLoadingList] = useState(true);
    
    const [selectedRider, setSelectedRider] = useState<Participant | null>(null);
    const [loadingDetails, setLoadingDetails] = useState(false);
    
    const [zpData, setZpData] = useState<ZwiftPowerResult[]>([]);
    const [stravaData, setStravaData] = useState<StravaActivity[]>([]);
    const [riderProfile, setRiderProfile] = useState<any>(null);
    const [error, setError] = useState('');

    // Fetch brief list of all participants for the search dropdown
    useEffect(() => {
        const fetchParticipants = async () => {
            try {
                const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
                const res = await fetch(`${apiUrl}/participants`);
                if (res.ok) {
                    const data = await res.json();
                    setParticipants(data.participants || []);
                }
            } catch (e) {
                console.error("Error loading participants", e);
            } finally {
                setLoadingList(false);
            }
        };
        fetchParticipants();
    }, []);

    const handleSelectRider = async (rider: Participant) => {
        setSelectedRider(rider);
        setLoadingDetails(true);
        setError('');
        setZpData([]);
        setStravaData([]);
        setRiderProfile(null);

        if (!user) return;

        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
            const token = await user.getIdToken();
            
            const res = await fetch(`${apiUrl}/admin/verification/rider/${rider.eLicense}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (res.ok) {
                const data = await res.json();
                setZpData(data.zwiftPowerHistory || []);
                setStravaData(data.stravaActivities || []);
                setRiderProfile(data.profile || {});
            } else {
                const err = await res.json();
                setError(err.message || 'Failed to fetch rider data');
            }
        } catch (e) {
            setError('Network error fetching rider data');
            console.error(e);
        } finally {
            setLoadingDetails(false);
        }
    };

    const filteredParticipants = participants.filter(p => 
        p.name.toLowerCase().includes(search.toLowerCase()) || 
        p.eLicense.includes(search)
    );

    return (
        <div className="max-w-6xl mx-auto">
            {/* 1. Search / Selector */}
            <div className="bg-card p-6 rounded-lg shadow border border-border mb-8">
                <h2 className="text-xl font-semibold mb-4 text-card-foreground">Rider Selection</h2>
                <div className="relative">
                    <input 
                        type="text" 
                        placeholder="Search by name or E-License..." 
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full p-3 border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-primary outline-none"
                    />
                    {search && (
                        <div className="absolute z-10 mt-1 w-full bg-card border border-border rounded-lg shadow-xl max-h-60 overflow-y-auto">
                            {filteredParticipants.map(p => (
                                <div 
                                    key={p.eLicense}
                                    onClick={() => {
                                        handleSelectRider(p);
                                        setSearch('');
                                    }}
                                    className="p-3 hover:bg-muted cursor-pointer flex justify-between items-center border-b border-border/50 last:border-0"
                                >
                                    <div>
                                        <span className="font-bold text-foreground">{p.name}</span>
                                        <span className="text-sm text-muted-foreground ml-2">({p.category})</span>
                                    </div>
                                    <span className="text-xs font-mono bg-secondary text-secondary-foreground px-2 py-1 rounded">
                                        {p.eLicense}
                                    </span>
                                </div>
                            ))}
                            {filteredParticipants.length === 0 && (
                                <div className="p-4 text-muted-foreground text-center">No riders found</div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* 2. Dashboard Grid */}
            {selectedRider && (
                <div className="space-y-6">
                    <div className="flex items-center justify-between">
                        <h2 className="text-2xl font-bold text-foreground">
                            Analysis: {selectedRider.name} 
                            <span className="ml-2 text-lg font-normal text-muted-foreground">
                                (Cat {selectedRider.category})
                            </span>
                        </h2>
                        <button 
                            onClick={() => handleSelectRider(selectedRider)}
                            disabled={loadingDetails}
                            className="px-4 py-2 bg-secondary text-secondary-foreground rounded hover:opacity-90 text-sm font-medium"
                        >
                            {loadingDetails ? 'Refreshing...' : 'Refresh Data'}
                        </button>
                    </div>

                    {error && (
                        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg">
                            {error}
                        </div>
                    )}

                    {loadingDetails ? (
                        <div className="p-12 text-center text-muted-foreground">Fetching performance data...</div>
                    ) : (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            
                            {/* Col 1: Profile & Physical */}
                            <div className="space-y-6">
                                <div className="bg-card rounded-lg shadow border border-border overflow-hidden">
                                    <div className="bg-muted/50 p-3 border-b border-border font-semibold text-card-foreground">
                                        Physical Profile
                                    </div>
                                    <div className="p-4 space-y-3">
                                        <div className="flex justify-between border-b border-border/50 pb-2">
                                            <span className="text-muted-foreground">Zwift ID</span>
                                            <span className="font-mono">{selectedRider.zwiftId}</span>
                                        </div>
                                        <div className="flex justify-between border-b border-border/50 pb-2">
                                            <span className="text-muted-foreground">Height</span>
                                            <span>{riderProfile?.height || 'N/A'} cm</span>
                                        </div>
                                        <div className="flex justify-between border-b border-border/50 pb-2">
                                            <span className="text-muted-foreground">Weight</span>
                                            <span>{riderProfile?.weight || 'N/A'} kg</span>
                                        </div>
                                        <div className="flex justify-between pb-2">
                                            <span className="text-muted-foreground">Avg HR Max (Est)</span>
                                            <span>{riderProfile?.maxHr || 'N/A'} bpm</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-card rounded-lg shadow border border-border overflow-hidden">
                                    <div className="bg-muted/50 p-3 border-b border-border font-semibold text-card-foreground">
                                        League Status
                                    </div>
                                    <div className="p-4 space-y-3">
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">Category</span>
                                            <span className="font-bold">{selectedRider.category}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">Rating</span>
                                            <span>{selectedRider.rating}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Col 2: ZwiftPower History */}
                            <div className="bg-card rounded-lg shadow border border-border overflow-hidden lg:col-span-1">
                                <div className="bg-[#FC6719]/10 p-3 border-b border-[#FC6719]/20 font-semibold text-[#FC6719] flex justify-between items-center">
                                    <span>ZwiftPower History</span>
                                    <span className="text-xs bg-[#FC6719] text-white px-2 py-0.5 rounded-full">Last 5 Races</span>
                                </div>
                                <div className="divide-y divide-border">
                                    {zpData.length === 0 ? (
                                        <div className="p-6 text-center text-muted-foreground italic">No recent race data found.</div>
                                    ) : (
                                        zpData.map((race, idx) => (
                                            <div key={idx} className="p-4 hover:bg-muted/30 transition">
                                                <div className="font-medium text-sm text-card-foreground truncate mb-1">{race.event_title}</div>
                                                <div className="text-xs text-muted-foreground mb-2">{new Date(race.date).toLocaleDateString()}</div>
                                                
                                                <div className="grid grid-cols-3 gap-2 text-center text-sm">
                                                    <div className="bg-secondary/50 rounded p-1">
                                                        <div className="text-xs text-muted-foreground">Power</div>
                                                        <div className="font-mono font-bold">{race.avg_watts}w</div>
                                                    </div>
                                                    <div className="bg-secondary/50 rounded p-1">
                                                        <div className="text-xs text-muted-foreground">W/Kg</div>
                                                        <div className="font-mono font-bold">{race.wkg.toFixed(2)}</div>
                                                    </div>
                                                    <div className="bg-secondary/50 rounded p-1">
                                                        <div className="text-xs text-muted-foreground">HR</div>
                                                        <div className={`font-mono font-bold ${race.avg_hr === 0 ? 'text-red-500' : ''}`}>
                                                            {race.avg_hr > 0 ? race.avg_hr : 'MISSING'}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>

                            {/* Col 3: Strava Activities */}
                            <div className="bg-card rounded-lg shadow border border-border overflow-hidden lg:col-span-1">
                                <div className="bg-[#FC4C02]/10 p-3 border-b border-[#FC4C02]/20 font-semibold text-[#FC4C02] flex justify-between items-center">
                                    <span>Strava Feed</span>
                                    <span className="text-xs bg-[#FC4C02] text-white px-2 py-0.5 rounded-full">Recent</span>
                                </div>
                                <div className="divide-y divide-border">
                                    {stravaData.length === 0 ? (
                                        <div className="p-6 text-center text-muted-foreground italic">
                                            No connected Strava account or activities found.
                                        </div>
                                    ) : (
                                        stravaData.map((act) => (
                                            <div key={act.id} className="p-4 hover:bg-muted/30 transition">
                                                <div className="font-medium text-sm text-card-foreground truncate mb-1">
                                                    <a href={`https://www.strava.com/activities/${act.id}`} target="_blank" rel="noopener noreferrer" className="hover:underline">
                                                        {act.name} ↗
                                                    </a>
                                                </div>
                                                <div className="text-xs text-muted-foreground mb-2">{new Date(act.date).toLocaleDateString()} • {(act.moving_time / 60).toFixed(0)} min</div>
                                                
                                                <div className="grid grid-cols-3 gap-2 text-center text-sm">
                                                    <div className="bg-secondary/50 rounded p-1">
                                                        <div className="text-xs text-muted-foreground">Avg Power</div>
                                                        <div className="font-mono">{act.average_watts ? `${act.average_watts}w` : '-'}</div>
                                                    </div>
                                                    <div className="bg-secondary/50 rounded p-1">
                                                        <div className="text-xs text-muted-foreground">Avg HR</div>
                                                        <div className="font-mono">{act.average_heartrate ? Math.round(act.average_heartrate) : '-'}</div>
                                                    </div>
                                                    <div className="bg-secondary/50 rounded p-1">
                                                        <div className="text-xs text-muted-foreground">Suffer</div>
                                                        <div className="font-mono">{act.suffer_score || '-'}</div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>

                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

