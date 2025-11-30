'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { 
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, 
    ComposedChart, Bar, Area, LabelList
} from 'recharts';

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
    date: number; // Unix timestamp
    event_title: string;
    avg_watts: number;
    avg_hr: number;
    wkg: number;
    category: string;
    weight: number;
    height: number;
    cp_curve: { [key: string]: number }; // w5, w15, etc.
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

    // Graph State
    const [selectedRaceDate, setSelectedRaceDate] = useState<number | null>(null);
    const [powerTrendStat, setPowerTrendStat] = useState<'avg' | 'w5' | 'w15' | 'w30' | 'w60' | 'w120' | 'w300' | 'w1200'>('avg');
    
    // Strava Detail State
    const [selectedStravaActivityId, setSelectedStravaActivityId] = useState<number | null>(null);
    const [stravaStreams, setStravaStreams] = useState<any[]>([]);
    const [loadingStreams, setLoadingStreams] = useState(false);

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
        setSelectedRaceDate(null);
        setSelectedStravaActivityId(null);
        setStravaStreams([]);
        setPowerTrendStat('avg');

        if (!user) return;

        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
            const token = await user.getIdToken();
            
            const res = await fetch(`${apiUrl}/admin/verification/rider/${rider.eLicense}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (res.ok) {
                const data = await res.json();
                
                // Ensure data is sorted by date ascending for graphs
                const history = (data.zwiftPowerHistory || []).sort((a: any, b: any) => a.date - b.date);
                setZpData(history);
                
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

    const handleSelectStravaActivity = async (activity: StravaActivity) => {
        if (activity.id === selectedStravaActivityId) return; // Already selected
        
        setSelectedStravaActivityId(activity.id);
        setLoadingStreams(true);
        setStravaStreams([]);

        if (!user || !selectedRider) return;

        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
            const token = await user.getIdToken();
            
            const res = await fetch(`${apiUrl}/admin/verification/strava/streams/${activity.id}?eLicense=${selectedRider.eLicense}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (res.ok) {
                const data = await res.json();
                const streams = data.streams;
                
                // Parse Streams
                // Expected format: [{type: 'time', data: [...]}, {type: 'watts', data: [...]}, ...]
                const timeStream = streams.find((s: any) => s.type === 'time')?.data || [];
                const wattsStream = streams.find((s: any) => s.type === 'watts')?.data || [];
                const cadenceStream = streams.find((s: any) => s.type === 'cadence')?.data || [];
                
                // Zip data
                const zipped = timeStream.map((t: number, i: number) => ({
                    time: t,
                    timeLabel: new Date(t * 1000).toISOString().substr(11, 8), // HH:MM:SS
                    watts: wattsStream[i] || 0,
                    cadence: cadenceStream[i] || 0
                }));
                
                setStravaStreams(zipped);
            } else {
                console.error("Failed to load streams");
            }
        } catch (e) {
            console.error("Error fetching streams", e);
        } finally {
            setLoadingStreams(false);
        }
    };

    const filteredParticipants = participants.filter(p => 
        p.name.toLowerCase().includes(search.toLowerCase()) || 
        p.eLicense.includes(search)
    );

    // --- Graph Data Preparation ---
    
    // 1. Weight & Height Graph Data (All History)
    const weightHeightData = zpData.map(d => ({
        date: new Date(d.date * 1000).toLocaleDateString(),
        timestamp: d.date,
        weight: d.weight > 0 ? d.weight : null, // Filter out 0s
        height: d.height > 0 ? d.height : null  // Filter out 0s
    })).filter(d => d.weight || d.height);

    // 2. Power Graph Data (Last 90 Days)
    const ninetyDaysAgo = Date.now() / 1000 - (90 * 24 * 60 * 60);
    const powerData = zpData.filter(d => d.date > ninetyDaysAgo).map(d => {
        // Determine power metric based on selection
        let powerVal = d.avg_watts;
        if (powerTrendStat !== 'avg') {
            // w5, w15 etc stored in cp_curve
            powerVal = d.cp_curve ? d.cp_curve[powerTrendStat] : 0;
        }

        return {
            date: new Date(d.date * 1000).toLocaleDateString(),
            timestamp: d.date,
            power: powerVal,
            hr: d.avg_hr,
            title: d.event_title
        };
    });

    // 3. CP Curve Data (Last 90 Days)
    // We transform this so each 'duration' (5s, 15s...) is an entry
    // and it has power values for ALL races in recent history.
    
    const cpDurations = [
        { key: 'w5', label: '5s' },
        { key: 'w15', label: '15s' },
        { key: 'w30', label: '30s' },
        { key: 'w60', label: '1m' },
        { key: 'w120', label: '2m' },
        { key: 'w300', label: '5m' },
        { key: 'w1200', label: '20m' }
    ];

    const recentRaces = zpData.filter(d => d.date > ninetyDaysAgo);
    
    // Calculate "Best of 90 Days" curve
    const bestCurve: {[key: string]: number} = {};
    cpDurations.forEach(dur => {
        bestCurve[dur.key] = 0;
        recentRaces.forEach(race => {
            const val = race.cp_curve ? race.cp_curve[dur.key] : 0;
            if (val > bestCurve[dur.key]) bestCurve[dur.key] = val;
        });
    });

    // Get Highlighted Race Curve
    const highlightedRace = selectedRaceDate 
        ? zpData.find(d => d.date === selectedRaceDate) 
        : null;

    // Construct the dataset for the chart.
    // Structure: { name: '5s', maxPower: 1200, highlightedPower: 1100, race_12345: 900, race_67890: 950... }
    const cpCurveData = cpDurations.map(dur => {
        const point: any = {
            name: dur.label,
            maxPower: bestCurve[dur.key],
            highlightedPower: highlightedRace && highlightedRace.cp_curve ? highlightedRace.cp_curve[dur.key] : null
        };

        // Add every other race as a separate key
        recentRaces.forEach(race => {
            // Only add if not the highlighted one (to avoid overlap/redundancy in rendering if desired, 
            // though standard practice is just render all and layer highlight on top)
            if (race.cp_curve) {
                point[`race_${race.date}`] = race.cp_curve[dur.key] || null;
            }
        });

        return point;
    });


    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            // Filter out the background race lines from tooltip to avoid clutter
            const visiblePayload = payload.filter((p: any) => 
                p.dataKey === 'maxPower' || p.dataKey === 'highlightedPower' ||
                p.dataKey === 'watts' || p.dataKey === 'cadence' ||
                p.dataKey === 'power' || p.dataKey === 'hr' ||
                p.dataKey === 'weight' || p.dataKey === 'height'
            );

            if (visiblePayload.length === 0) return null;

            return (
                <div className="bg-card p-2 border border-border rounded shadow text-sm z-50">
                    <p className="font-bold mb-1">{label}</p>
                    {visiblePayload.map((p: any) => (
                        <p key={p.name} style={{ color: p.color }}>
                            {p.name}: {p.value} {p.unit}
                        </p>
                    ))}
                    {visiblePayload[0]?.payload?.title && (
                        <p className="text-xs text-muted-foreground mt-1 max-w-[200px] truncate">
                            {visiblePayload[0].payload.title}
                        </p>
                    )}
                </div>
            );
        }
        return null;
    };

    const selectedStravaActivityDetails = stravaData.find(a => a.id === selectedStravaActivityId);

    // Format Date tick to prevent overlap (show DD/MM only, skip some)
    const renderDateTick = (tickProps: any) => {
        const { x, y, payload, index } = tickProps;
        // Show every 3rd label roughly, or based on width
        if (index % 2 !== 0) return null;

        return (
            <text x={x} y={y + 10} textAnchor="middle" fill="var(--muted-foreground)" fontSize={10}>
                {payload.value.split('/').slice(0,2).join('/')}
            </text>
        );
    };

    return (
        <div className="max-w-6xl mx-auto pb-12">
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
                <div className="space-y-8">
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
                        <>
                            {/* --- GRAPH SECTION --- */}
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                {/* Graph 1: Power Curve (90 Days) */}
                                <div className="bg-card p-4 rounded-lg shadow border border-border lg:col-span-1">
                                    <h3 className="text-lg font-semibold mb-4 text-card-foreground">90 Day Power Curve</h3>
                                    <div className="h-[300px] w-full">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <LineChart data={cpCurveData}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
                                                <XAxis 
                                                    dataKey="name" 
                                                    tick={{fontSize: 10, fill: 'var(--muted-foreground)'}}
                                                />
                                                <YAxis 
                                                    label={{ value: 'Watts', angle: -90, position: 'insideLeft', style: {textAnchor: 'middle', fill: '#8884d8', fontSize: 12} }}
                                                    tick={{fontSize: 10, fill: 'var(--muted-foreground)'}}
                                                />
                                                <Tooltip content={<CustomTooltip />} />
                                                <Legend 
                                                    verticalAlign="top" 
                                                    height={36}
                                                    content={() => (
                                                        <div className="flex justify-center gap-4 text-sm text-muted-foreground">
                                                            <div className="flex items-center gap-2">
                                                                <span className="block w-3 h-[2px] bg-[#8884d8]"></span>
                                                                <span>Best (90d)</span>
                                                            </div>
                                                            {selectedRaceDate && (
                                                                <div className="flex items-center gap-2">
                                                                    <span className="block w-3 h-[2px] bg-[#ff7300]"></span>
                                                                    <span>Selected Race</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                />
                                                
                                                {/* Render faint lines for EVERY race in the last 90 days */}
                                                {recentRaces.map((race) => (
                                                    <Line
                                                        key={race.date}
                                                        type="monotone"
                                                        dataKey={`race_${race.date}`}
                                                        stroke="#8884d8"
                                                        strokeOpacity={0.15} // Very faint
                                                        strokeWidth={1}
                                                        dot={false}
                                                        isAnimationActive={false} // Disable animation for performance with many lines
                                                    />
                                                ))}

                                                <Line 
                                                    type="monotone" 
                                                    dataKey="maxPower" 
                                                    stroke="#8884d8" 
                                                    name="Best (90d)" 
                                                    unit="W"
                                                    strokeWidth={2}
                                                    dot={{ r: 3 }}
                                                />
                                                {selectedRaceDate && (
                                                    <Line 
                                                        type="monotone" 
                                                        dataKey="highlightedPower" 
                                                        stroke="#ff7300" 
                                                        name="Selected Race" 
                                                        unit="W"
                                                        strokeWidth={2}
                                                        dot={{ r: 4 }}
                                                    />
                                                )}
                                            </LineChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>

                                {/* Graph 2: Weight & Height */}
                                <div className="bg-card p-4 rounded-lg shadow border border-border lg:col-span-1">
                                    <h3 className="text-lg font-semibold mb-4 text-card-foreground">Physical Profile</h3>
                                    <div className="h-[300px] w-full">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <ComposedChart data={weightHeightData}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
                                                <XAxis 
                                                    dataKey="date" 
                                                    tick={{fontSize: 10, fill: 'var(--muted-foreground)'}} 
                                                    interval={2} // Show fewer labels
                                                />
                                                <YAxis 
                                                    yAxisId="left" 
                                                    orientation="left" 
                                                    domain={['dataMin - 5', 'dataMax + 5']} 
                                                    label={{ value: 'Height (cm)', angle: -90, position: 'insideLeft', style: {textAnchor: 'middle', fill: '#8884d8', fontSize: 12} }}
                                                    tick={{fontSize: 10, fill: 'var(--muted-foreground)'}}
                                                />
                                                <YAxis 
                                                    yAxisId="right" 
                                                    orientation="right" 
                                                    domain={['dataMin - 2', 'dataMax + 2']} 
                                                    label={{ value: 'Weight (kg)', angle: 90, position: 'insideRight', style: {textAnchor: 'middle', fill: '#82ca9d', fontSize: 12} }}
                                                    tick={{fontSize: 10, fill: 'var(--muted-foreground)'}}
                                                />
                                                <Tooltip content={<CustomTooltip />} />
                                                <Legend verticalAlign="top" height={36}/>
                                                <Line 
                                                    yAxisId="left"
                                                    type="monotone" 
                                                    dataKey="height" 
                                                    stroke="#8884d8" 
                                                    name="Height" 
                                                    unit="cm"
                                                    dot={false}
                                                    strokeWidth={2}
                                                >
                                                     <LabelList dataKey="height" position="top" offset={10} fontSize={10} fill="#8884d8" />
                                                </Line>
                                                <Line 
                                                    yAxisId="right"
                                                    type="stepAfter" 
                                                    dataKey="weight" 
                                                    stroke="#82ca9d" 
                                                    name="Weight" 
                                                    unit="kg"
                                                    dot={false}
                                                    strokeWidth={2}
                                                >
                                                    <LabelList dataKey="weight" position="top" offset={10} fontSize={10} fill="#82ca9d" />
                                                </Line>
                                            </ComposedChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>

                                {/* Graph 3: Power Trend (90 Days) */}
                                <div className="bg-card p-4 rounded-lg shadow border border-border lg:col-span-1 flex flex-col">
                                    <div className="flex justify-between items-start mb-4">
                                        <h3 className="text-lg font-semibold text-card-foreground">Race Power Trend</h3>
                                        <select 
                                            className="text-xs bg-background border border-input rounded px-2 py-1"
                                            value={powerTrendStat}
                                            onChange={(e) => setPowerTrendStat(e.target.value as any)}
                                        >
                                            <option value="avg">Avg Power</option>
                                            <option value="w5">5s Power</option>
                                            <option value="w15">15s Power</option>
                                            <option value="w30">30s Power</option>
                                            <option value="w60">1m Power</option>
                                            <option value="w300">5m Power</option>
                                            <option value="w1200">20m Power</option>
                                        </select>
                                    </div>
                                    <div className="h-[300px] w-full">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <LineChart data={powerData}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
                                                <XAxis 
                                                    dataKey="date" 
                                                    tick={{fontSize: 10, fill: 'var(--muted-foreground)'}}
                                                    interval={1} // Skipping labels
                                                />
                                                <YAxis 
                                                    label={{ value: 'Watts', angle: -90, position: 'insideLeft', style: {textAnchor: 'middle', fill: '#ff7300', fontSize: 12} }}
                                                    tick={{fontSize: 10, fill: 'var(--muted-foreground)'}}
                                                />
                                                <Tooltip content={<CustomTooltip />} />
                                                <Legend verticalAlign="top" height={36}/>
                                                
                                                {/* Reference Line for Highlighted Race */}
                                                <Line 
                                                    type="monotone" 
                                                    dataKey="power" 
                                                    stroke="#ff7300" 
                                                    name={powerTrendStat === 'avg' ? 'Avg Power' : `${powerTrendStat} Power`}
                                                    unit="W"
                                                    strokeWidth={2}
                                                    activeDot={{ r: 8 }}
                                                    dot={(props: any) => {
                                                        // Highlight selected race if timestamp matches
                                                        if (selectedRaceDate && props.payload.timestamp === selectedRaceDate) {
                                                            return <circle cx={props.cx} cy={props.cy} r={6} fill="#ff0000" stroke="none" />;
                                                        }
                                                        return <circle cx={props.cx} cy={props.cy} r={0} />; // Invisible dots normally
                                                    }}
                                                >
                                                     <LabelList dataKey="power" position="top" offset={10} fontSize={10} fill="#ff7300" />
                                                </Line>
                                                <Line 
                                                    type="monotone" 
                                                    dataKey="hr" 
                                                    stroke="#ff0000" 
                                                    name="Avg HR" 
                                                    unit="bpm"
                                                    strokeWidth={1}
                                                    strokeDasharray="5 5"
                                                    opacity={0.6}
                                                    dot={false}
                                                />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            </div>

                            {/* --- STRAVA DETAIL GRAPH --- */}
                            {selectedStravaActivityId && (
                                <div className="bg-card p-4 rounded-lg shadow border border-border mt-6 relative">
                                    <div className="flex justify-between items-center mb-4">
                                        <h3 className="text-lg font-semibold text-card-foreground">
                                            Strava Analysis: {selectedStravaActivityDetails?.name}
                                        </h3>
                                        <button 
                                            onClick={() => {
                                                setSelectedStravaActivityId(null);
                                                setStravaStreams([]);
                                            }}
                                            className="p-1 hover:bg-muted rounded-full transition"
                                            title="Close Analysis"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
                                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                                <line x1="6" y1="6" x2="18" y2="18"></line>
                                            </svg>
                                        </button>
                                    </div>
                                    
                                    {loadingStreams ? (
                                        <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                                            Loading stream data...
                                        </div>
                                    ) : stravaStreams.length > 0 ? (
                                        <div className="h-[300px] w-full">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <LineChart data={stravaStreams}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
                                                    <XAxis 
                                                        dataKey="timeLabel" 
                                                        tick={{fontSize: 10, fill: 'var(--muted-foreground)'}}
                                                        minTickGap={50}
                                                    />
                                                    <YAxis 
                                                        yAxisId="left"
                                                        label={{ value: 'Power (W)', angle: -90, position: 'insideLeft', style: {textAnchor: 'middle', fill: '#FC4C02', fontSize: 12} }}
                                                        tick={{fontSize: 10, fill: 'var(--muted-foreground)'}}
                                                    />
                                                    <YAxis 
                                                        yAxisId="right"
                                                        orientation="right"
                                                        label={{ value: 'Cadence (rpm)', angle: 90, position: 'insideRight', style: {textAnchor: 'middle', fill: '#82ca9d', fontSize: 12} }}
                                                        tick={{fontSize: 10, fill: 'var(--muted-foreground)'}}
                                                    />
                                                    <Tooltip content={<CustomTooltip />} />
                                                    <Legend verticalAlign="top" height={36}/>
                                                    <Line 
                                                        yAxisId="left"
                                                        type="monotone" 
                                                        dataKey="watts" 
                                                        stroke="#FC4C02" 
                                                        name="Power" 
                                                        unit="W"
                                                        dot={false}
                                                        strokeWidth={1.5}
                                                    />
                                                    <Line 
                                                        yAxisId="right"
                                                        type="monotone" 
                                                        dataKey="cadence" 
                                                        stroke="#82ca9d" 
                                                        name="Cadence" 
                                                        unit="rpm"
                                                        dot={false}
                                                        strokeWidth={1.5}
                                                        opacity={0.7}
                                                    />
                                                </LineChart>
                                            </ResponsiveContainer>
                                        </div>
                                    ) : (
                                        <div className="h-[300px] flex items-center justify-center text-muted-foreground italic">
                                            No stream data available for this activity.
                                        </div>
                                    )}
                                </div>
                            )}


                            {/* --- DATA TABLES --- */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
                                
                                {/* Col 1: ZwiftPower Table (Clickable) */}
                                <div className="bg-card rounded-lg shadow border border-border overflow-hidden lg:col-span-1">
                                    <div className="bg-[#FC6719]/10 p-3 border-b border-[#FC6719]/20 font-semibold text-[#FC6719] flex justify-between items-center">
                                        <span>ZwiftPower Feed</span>
                                        <span className="text-xs bg-[#FC6719] text-white px-2 py-0.5 rounded-full">Last 10 Races</span>
                                    </div>
                                    <div className="divide-y divide-border max-h-[500px] overflow-y-auto">
                                        {zpData.length === 0 ? (
                                            <div className="p-6 text-center text-muted-foreground italic">No recent race data found.</div>
                                        ) : (
                                            // Show last 10 reversed (newest first)
                                            [...zpData].reverse().slice(0, 10).map((race, idx) => {
                                                const isSelected = selectedRaceDate === race.date;
                                                return (
                                                    <div 
                                                        key={idx} 
                                                        onClick={() => setSelectedRaceDate(race.date)}
                                                        className={`p-4 transition cursor-pointer border-l-4 ${isSelected ? 'bg-muted/50 border-primary' : 'hover:bg-muted/30 border-transparent'}`}
                                                    >
                                                        <div className="font-medium text-sm text-card-foreground truncate mb-1">{race.event_title}</div>
                                                        <div className="text-xs text-muted-foreground mb-2">{new Date(race.date * 1000).toLocaleDateString()}</div>
                                                        
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
                                                );
                                            })
                                        )}
                                    </div>
                                </div>

                                {/* Col 2: Strava Activities */}
                                <div className="bg-card rounded-lg shadow border border-border overflow-hidden lg:col-span-1">
                                    <div className="bg-[#FC4C02]/10 p-3 border-b border-[#FC4C02]/20 font-semibold text-[#FC4C02] flex justify-between items-center">
                                        <span>Strava Feed</span>
                                        <span className="text-xs bg-[#FC4C02] text-white px-2 py-0.5 rounded-full">Recent</span>
                                    </div>
                                    <div className="divide-y divide-border max-h-[500px] overflow-y-auto">
                                        {stravaData.length === 0 ? (
                                            <div className="p-6 text-center text-muted-foreground italic">
                                                No connected Strava account or activities found.
                                            </div>
                                        ) : (
                                            stravaData.map((act) => {
                                                const isSelected = selectedStravaActivityId === act.id;
                                                return (
                                                    <div 
                                                        key={act.id} 
                                                        onClick={() => handleSelectStravaActivity(act)}
                                                        className={`p-4 transition cursor-pointer border-l-4 ${isSelected ? 'bg-muted/50 border-[#FC4C02]' : 'hover:bg-muted/30 border-transparent'}`}
                                                    >
                                                        <div className="font-medium text-sm text-card-foreground truncate mb-1 flex justify-between items-center">
                                                            <span>{act.name}</span>
                                                            <a href={`https://www.strava.com/activities/${act.id}`} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline" onClick={(e) => e.stopPropagation()}>
                                                                Link ↗
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
                                                );
                                            })
                                        )}
                                    </div>
                                </div>

                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
