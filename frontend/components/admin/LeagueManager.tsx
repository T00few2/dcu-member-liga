'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';

interface Route {
  id: string;
  name: string;
  map: string;
  distance: number;
  elevation: number;
  leadinDistance: number;
  leadinElevation: number;
}

interface Segment {
  id: string;
  name: string;
  count: number;
  direction: string;
  lap: number;
}

interface SelectedSegment extends Segment {
    key: string;
}

interface Race {
  id: string;
  name: string;
  date: string;
  routeId: string;
  routeName: string;
  map: string;
  laps: number;
  totalDistance: number;
  totalElevation: number;
  eventId?: string; // Added Event ID
  selectedSegments?: string[]; // List of segment unique keys (id_count) - KEPT FOR BACKWARDS COMPAT
  sprints?: SelectedSegment[]; // Full segment objects
}

interface LeagueSettings {
  finishPoints: number[];
  sprintPoints: number[];
}

export default function LeagueManager() {
  const { user, loading: authLoading } = useAuth();
  
  // Data State
  const [routes, setRoutes] = useState<Route[]>([]);
  const [races, setRaces] = useState<Race[]>([]);
  const [availableSegments, setAvailableSegments] = useState<Segment[]>([]);
  const [leagueSettings, setLeagueSettings] = useState<LeagueSettings>({ finishPoints: [], sprintPoints: [] });
  
  // Tabs
  const [activeTab, setActiveTab] = useState<'races' | 'settings'>('races');

  // Race Form State
  const [editingRaceId, setEditingRaceId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [eventId, setEventId] = useState('');
  const [selectedMap, setSelectedMap] = useState('');
  const [selectedRouteId, setSelectedRouteId] = useState('');
  const [laps, setLaps] = useState(1);
  
  // We now store selected sprints as full objects for better UI display later
  const [selectedSprints, setSelectedSprints] = useState<SelectedSegment[]>([]);
  
  // Settings Form State
  const [finishPointsStr, setFinishPointsStr] = useState('');
  const [sprintPointsStr, setSprintPointsStr] = useState('');
  
  // Generator State
  const [genStart, setGenStart] = useState(130);
  const [genEnd, setGenEnd] = useState(1);
  const [genStep, setGenStep] = useState(1);
  const [genTarget, setGenTarget] = useState<'finish' | 'sprint'>('finish');

  const [status, setStatus] = useState<'idle' | 'loading' | 'saving' | 'seeding' | 'refreshing'>('idle');
  const [error, setError] = useState('');

  // Results Fetch Mode (Data Source)
  const [resultSource, setResultSource] = useState<'finishers' | 'joined' | 'signed_up'>('finishers');
  const [filterRegistered, setFilterRegistered] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState('All');

  // Fetch Initial Data
  useEffect(() => {
    const fetchData = async () => {
        if (!user) return;
        setStatus('loading');
        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
            const token = await user.getIdToken();
            
            const [routesRes, racesRes, settingsRes] = await Promise.all([
                fetch(`${apiUrl}/routes`),
                fetch(`${apiUrl}/races`, { headers: { 'Authorization': `Bearer ${token}` } }),
                fetch(`${apiUrl}/league/settings`, { headers: { 'Authorization': `Bearer ${token}` } })
            ]);

            const routesData = await routesRes.json();
            setRoutes(routesData.routes || []);

            if (racesRes.ok) {
                const racesData = await racesRes.json();
                setRaces(racesData.races || []);
            }
            
            if (settingsRes.ok) {
                const settingsData = await settingsRes.json();
                const settings = settingsData.settings || {};
                setLeagueSettings({
                    finishPoints: settings.finishPoints || [],
                    sprintPoints: settings.sprintPoints || []
                });
                setFinishPointsStr((settings.finishPoints || []).join(', '));
                setSprintPointsStr((settings.sprintPoints || []).join(', '));
            }

        } catch (e) {
            setError('Failed to load data');
            console.error(e);
        } finally {
            setStatus('idle');
        }
    };
    
    if (user && !authLoading) {
        fetchData();
    }
  }, [user, authLoading]);

  // Fetch Segments when Route/Laps change
  useEffect(() => {
      if (!selectedRouteId) {
          setAvailableSegments([]);
          return;
      }
      
      const fetchSegments = async () => {
          try {
              const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
              const res = await fetch(`${apiUrl}/segments?routeId=${selectedRouteId}&laps=${laps}`);
              if (res.ok) {
                  const data = await res.json();
                  setAvailableSegments(data.segments || []);
              }
          } catch (e) {
              console.error("Error fetching segments:", e);
          }
      };
      fetchSegments();
  }, [selectedRouteId, laps]);

  // --- Derived Data ---
  const maps = Array.from(new Set(routes.map(r => r.map))).sort();
  const filteredRoutes = selectedMap ? routes.filter(r => r.map === selectedMap) : [];
  const selectedRoute = routes.find(r => r.id === selectedRouteId);

  // Group segments by lap
  const segmentsByLap = availableSegments.reduce((acc, seg) => {
      const lap = seg.lap || 1;
      if (!acc[lap]) acc[lap] = [];
      acc[lap].push(seg);
      return acc;
  }, {} as Record<number, Segment[]>);

  // --- Handlers ---

  const handleEdit = (race: Race) => {
      setEditingRaceId(race.id);
      setName(race.name);
      setDate(race.date);
      setEventId(race.eventId || '');
      setSelectedMap(race.map);
      setSelectedRouteId(race.routeId);
      setLaps(race.laps);
      
      // Handle backwards compatibility or new structure
      if (race.sprints) {
          setSelectedSprints(race.sprints);
      } else if (race.selectedSegments) {
          setSelectedSprints([]);
      } else {
          setSelectedSprints([]);
      }
      
      window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancel = () => {
      setEditingRaceId(null);
      setName('');
      setDate('');
      setEventId('');
      setSelectedMap('');
      setSelectedRouteId('');
      setLaps(1);
      setSelectedSprints([]);
  };

  const generatePoints = () => {
      const points = [];
      if (genStart > genEnd) {
          // Decreasing
          for (let i = genStart; i >= genEnd; i -= genStep) {
              points.push(i);
          }
      } else {
          // Increasing
          for (let i = genStart; i <= genEnd; i += genStep) {
              points.push(i);
          }
      }
      const str = points.join(', ');
      if (genTarget === 'finish') {
          setFinishPointsStr(str);
      } else {
          setSprintPointsStr(str);
      }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!user) return;
      
      setStatus('saving');
      try {
          const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
          const token = await user.getIdToken();
          
          const finishPoints = finishPointsStr.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
          const sprintPoints = sprintPointsStr.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
          
          const res = await fetch(`${apiUrl}/league/settings`, {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify({ finishPoints, sprintPoints })
          });
          
          if (res.ok) {
              alert('Settings saved!');
              setLeagueSettings({ finishPoints, sprintPoints });
          } else {
              alert('Failed to save settings');
          }
      } catch (e) {
          alert('Error saving settings');
      } finally {
          setStatus('idle');
      }
  };
  
  const handleSeedData = async () => {
      if (!user || !confirm('This will generate 20 fake users with random data. Continue?')) return;
      setStatus('seeding');
      try {
          const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
          const token = await user.getIdToken();
          const res = await fetch(`${apiUrl}/admin/seed`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${token}` }
          });
          
          if (res.ok) {
              alert('Test data generated successfully! Check the Participants page.');
          } else {
              const data = await res.json();
              alert(`Failed: ${data.message}`);
          }
      } catch (e) {
          alert('Error generating data');
      } finally {
          setStatus('idle');
      }
  };

  const handleRefreshResults = async (raceId: string) => {
      if (!user) return;
      if (!confirm('Calculate results? This may take a few seconds.')) return;
      
      setStatus('refreshing');
      try {
          const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
          const token = await user.getIdToken();
          const res = await fetch(`${apiUrl}/races/${raceId}/results/refresh`, {
              method: 'POST',
              headers: { 
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json'
              },
              body: JSON.stringify({ 
                  source: resultSource,
                  filterRegistered: filterRegistered,
                  categoryFilter: categoryFilter
              })
          });
          
          if (res.ok) {
              alert('Results updated successfully!');
          } else {
              const data = await res.json();
              alert(`Failed: ${data.message}`);
          }
      } catch (e) {
          alert('Error updating results');
      } finally {
          setStatus('idle');
      }
  };

  const handleSaveRace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedRoute) return;
    
    setStatus('saving');
    try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
        const token = await user.getIdToken();
        
        const calcDistance = (selectedRoute.distance * laps + selectedRoute.leadinDistance).toFixed(1);
        const calcElevation = Math.round(selectedRoute.elevation * laps + selectedRoute.leadinElevation);

        const raceData = {
            name,
            date,
            eventId, // Include Event ID
            routeId: selectedRoute.id,
            routeName: selectedRoute.name,
            map: selectedRoute.map,
            laps,
            totalDistance: Number(calcDistance),
            totalElevation: Number(calcElevation),
            selectedSegments: selectedSprints.map(s => s.key), // Keep for legacy/compat
            sprints: selectedSprints // Save full objects
        };
        
        const method = editingRaceId ? 'PUT' : 'POST';
        const url = editingRaceId ? `${apiUrl}/races/${editingRaceId}` : `${apiUrl}/races`;

        const res = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(raceData)
        });
        
        if (res.ok) {
            const data = await res.json();
            const savedRace = { ...raceData, id: editingRaceId || data.id };
            
            if (editingRaceId) {
                setRaces(races.map(r => r.id === editingRaceId ? savedRace : r));
            } else {
                setRaces([...races, savedRace]);
            }
            handleCancel();
        } else {
            const err = await res.json();
            alert(`Error: ${err.message}`);
        }
    } catch (e) {
        alert('Failed to save race');
    } finally {
        setStatus('idle');
    }
  };

  const handleDeleteRace = async (id: string) => {
      if (!user || !confirm('Delete this race?')) return;
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
        const token = await user.getIdToken();
        await fetch(`${apiUrl}/races/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        setRaces(races.filter(r => r.id !== id));
      } catch (e) {
          alert('Failed to delete');
      }
  };

  const toggleSegment = (seg: Segment) => {
      // Construct unique key
      const key = `${seg.id}_${seg.count}`;
      if (selectedSprints.some(s => s.key === key)) {
          setSelectedSprints(selectedSprints.filter(s => s.key !== key));
      } else {
          setSelectedSprints([...selectedSprints, { ...seg, key }]);
      }
  };

  if (authLoading || status === 'loading') return <div className="p-8 text-center">Loading...</div>;

  return (
    <div>
      <div className="flex gap-4 mb-8 border-b border-border">
          <button 
            onClick={() => setActiveTab('races')}
            className={`pb-2 px-4 font-medium transition ${activeTab === 'races' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
          >
              Races
          </button>
          <button 
            onClick={() => setActiveTab('settings')}
            className={`pb-2 px-4 font-medium transition ${activeTab === 'settings' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
          >
              Scoring Settings
          </button>
      </div>

      {activeTab === 'settings' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-8">
                <div className="bg-card p-6 rounded-lg shadow border border-border">
                    <h2 className="text-xl font-semibold mb-6 text-card-foreground">Scoring Rules</h2>
                    <form onSubmit={handleSaveSettings} className="space-y-6">
                        <div>
                            <label className="block font-medium text-card-foreground mb-2">Finish Points (1st, 2nd, 3rd...)</label>
                            <p className="text-xs text-muted-foreground mb-2">Comma-separated list of points awarded by position.</p>
                            <textarea 
                                value={finishPointsStr}
                                onChange={e => setFinishPointsStr(e.target.value)}
                                className="w-full p-3 border border-input rounded-lg bg-background text-foreground h-24 font-mono text-sm"
                                placeholder="e.g. 100, 95, 90, 85, 80..."
                            />
                        </div>
                        <div>
                            <label className="block font-medium text-card-foreground mb-2">Sprint Points (1st, 2nd, 3rd...)</label>
                            <p className="text-xs text-muted-foreground mb-2">Points awarded for intermediate sprints.</p>
                            <textarea 
                                value={sprintPointsStr}
                                onChange={e => setSprintPointsStr(e.target.value)}
                                className="w-full p-3 border border-input rounded-lg bg-background text-foreground h-24 font-mono text-sm"
                                placeholder="e.g. 10, 9, 8, 7, 6..."
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

                {/* Test Data Generation */}
                <div className="bg-card p-6 rounded-lg shadow border border-border border-dashed border-slate-300 dark:border-slate-700">
                    <h3 className="text-lg font-semibold mb-2 text-card-foreground">Development Tools</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                        Need to test the layout with multiple users but limited by Strava API restrictions? 
                        Generate fake participants here.
                    </p>
                    <button
                        type="button"
                        onClick={handleSeedData}
                        disabled={status === 'seeding'}
                        className="bg-slate-800 text-white px-4 py-2 rounded hover:bg-slate-700 text-sm font-medium disabled:opacity-50"
                    >
                        {status === 'seeding' ? 'Generating...' : 'Generate 20 Test Participants'}
                    </button>
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
                                className={`flex-1 py-1 px-2 text-sm rounded border ${genTarget === 'finish' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-foreground border-input'}`}
                            >
                                Finish
                            </button>
                            <button 
                                type="button"
                                onClick={() => setGenTarget('sprint')}
                                className={`flex-1 py-1 px-2 text-sm rounded border ${genTarget === 'sprint' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-foreground border-input'}`}
                            >
                                Sprint
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
      )}

      {activeTab === 'races' && (
        <>
          {/* Race Form */}
          <div className="bg-card p-6 rounded-lg shadow mb-8 border border-border">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold text-card-foreground">
                    {editingRaceId ? 'Edit Scheduled Race' : 'Schedule New Race'}
                </h2>
                {editingRaceId && (
                    <button onClick={handleCancel} className="text-sm text-muted-foreground hover:text-foreground">
                        Cancel Edit
                    </button>
                )}
              </div>
              
              <form onSubmit={handleSaveRace} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                          <label className="block text-sm font-medium text-muted-foreground mb-1">Race Name</label>
                          <input 
                            type="text" 
                            required
                            value={name}
                            onChange={e => setName(e.target.value)}
                            className="w-full p-2 border border-input rounded bg-background text-foreground"
                            placeholder="e.g. League Opener"
                          />
                      </div>
                      <div>
                          <label className="block text-sm font-medium text-muted-foreground mb-1">Date & Time</label>
                          <input 
                            type="datetime-local" 
                            required
                            value={date}
                            onChange={e => setDate(e.target.value)}
                            className="w-full p-2 border border-input rounded bg-background text-foreground"
                            />
                      </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div>
                          <label className="block text-sm font-medium text-muted-foreground mb-1">Select Map</label>
                          <select 
                            value={selectedMap}
                            onChange={e => {
                                setSelectedMap(e.target.value);
                                setSelectedRouteId('');
                            }}
                            className="w-full p-2 border border-input rounded bg-background text-foreground"
                            required
                          >
                              <option value="">-- Choose a Map --</option>
                              {maps.map(m => (
                                  <option key={m} value={m}>{m}</option>
                              ))}
                          </select>
                      </div>
                      <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-muted-foreground mb-1">Select Route</label>
                          <select 
                            value={selectedRouteId}
                            onChange={e => setSelectedRouteId(e.target.value)}
                            className="w-full p-2 border border-input rounded bg-background text-foreground"
                            required
                            disabled={!selectedMap}
                          >
                              <option value="">
                                  {selectedMap ? '-- Choose a Route --' : '-- Select Map First --'}
                              </option>
                              {filteredRoutes.map(r => (
                                  <option key={r.id} value={r.id}>
                                      {r.name} ({r.distance.toFixed(1)}km, {r.elevation}m)
                                  </option>
                              ))}
                          </select>
                      </div>
                  </div>

                  {selectedRoute && (
                      <div className="p-4 bg-muted/50 rounded-lg border border-border">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-4">
                              <div>
                                  <label className="block font-medium text-muted-foreground mb-1">Laps</label>
                                  <input 
                                    type="number" 
                                    min="1" 
                                    value={laps}
                                    onChange={e => setLaps(parseInt(e.target.value) || 1)}
                                    className="w-20 p-1 border border-input rounded bg-background text-foreground"
                                  />
                              </div>
                              <div className="text-card-foreground flex flex-col justify-end">
                                  <span className="text-sm text-muted-foreground">Total Distance</span>
                                  <span className="font-mono font-medium">
                                      {((selectedRoute.distance * laps) + selectedRoute.leadinDistance).toFixed(1)} km
                                  </span>
                              </div>
                              <div className="text-card-foreground flex flex-col justify-end">
                                  <span className="text-sm text-muted-foreground">Total Elevation</span>
                                  <span className="font-mono font-medium">
                                      {Math.round(selectedRoute.elevation * laps + selectedRoute.leadinElevation)} m
                                  </span>
                              </div>
                          </div>

                          <div className="mb-4">
                              <label className="block text-sm font-medium text-muted-foreground mb-1">ZwiftPower Event ID (Optional)</label>
                              <input 
                                type="text" 
                                value={eventId}
                                onChange={e => setEventId(e.target.value)}
                                className="w-full p-2 border border-input rounded bg-background text-foreground"
                                placeholder="e.g. 123456"
                              />
                              <p className="text-xs text-muted-foreground mt-1">Used to fetch race results automatically.</p>
                          </div>

                          {/* Segment Selection */}
                          <div className="border-t border-border pt-4">
                              <label className="block font-medium text-card-foreground mb-3">Sprint Segments (Scoring)</label>
                              {availableSegments.length === 0 ? (
                                  <p className="text-sm text-muted-foreground italic">No known segments on this route.</p>
                              ) : (
                                  <div className="space-y-4 max-h-96 overflow-y-auto">
                                      {Object.keys(segmentsByLap).sort((a,b) => parseInt(a)-parseInt(b)).map(lapKey => {
                                          const lapNum = parseInt(lapKey);
                                          return (
                                              <div key={lapNum} className="border border-border rounded-md overflow-hidden">
                                                  <div className="bg-muted/30 px-3 py-2 text-sm font-semibold text-muted-foreground border-b border-border">
                                                      Lap {lapNum}
                                                  </div>
                                                  <div className="p-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                                                      {segmentsByLap[lapNum].map((seg, idx) => {
                                                          const uniqueKey = `${seg.id}_${seg.count}`;
                                                          const isSelected = selectedSprints.some(s => s.key === uniqueKey);
                                                          return (
                                                              <label key={uniqueKey} className="flex items-center gap-3 p-2 rounded hover:bg-muted/50 cursor-pointer border border-transparent hover:border-border transition">
                                                                  <input 
                                                                    type="checkbox"
                                                                    checked={isSelected}
                                                                    onChange={() => toggleSegment(seg)}
                                                                    className="w-4 h-4 rounded border-input text-primary focus:ring-primary"
                                                                  />
                                                                  <div className="text-sm">
                                                                      <div className="font-medium text-foreground">{seg.name}</div>
                                                                      <div className="text-xs text-muted-foreground">
                                                                          {seg.direction} • Occurrence #{seg.count}
                                                                      </div>
                                                                  </div>
                                                              </label>
                                                          );
                                                      })}
                                                  </div>
                                              </div>
                                          );
                                      })}
                                  </div>
                              )}
                          </div>
                      </div>
                  )}

                  <div className="flex gap-3 pt-2">
                      <button 
                        type="submit" 
                        disabled={status === 'saving'}
                        className="bg-primary text-primary-foreground px-6 py-2 rounded hover:opacity-90 font-medium shadow-sm"
                      >
                          {status === 'saving' ? 'Saving...' : (editingRaceId ? 'Update Race' : 'Create Race')}
                      </button>
                      {editingRaceId && (
                          <button 
                              type="button"
                              onClick={handleCancel}
                              className="bg-secondary text-secondary-foreground px-4 py-2 rounded hover:opacity-90"
                          >
                              Cancel
                          </button>
                      )}
                  </div>
              </form>
          </div>

          {/* Existing Races List */}
          <div className="bg-card rounded-lg shadow overflow-hidden border border-border">
              <div className="flex flex-col gap-4 p-6 border-b border-border">
                  <div className="flex justify-between items-end">
                      <h2 className="text-xl font-semibold text-card-foreground">Scheduled Races</h2>
                      
                      <div className="flex flex-col gap-2 items-end">
                          <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Results Fetch Options</span>
                          <div className="flex items-center gap-4 p-2 bg-muted/30 rounded-lg border border-border/50">
                              <div className="flex items-center gap-2">
                                  <label className="text-sm text-muted-foreground font-medium">Category:</label>
                                  <select 
                                      value={categoryFilter}
                                      onChange={(e) => setCategoryFilter(e.target.value)}
                                      className="bg-background border border-input rounded px-2 py-1 text-sm font-medium text-foreground focus:ring-1 focus:ring-primary"
                                  >
                                      {['All', 'A', 'B', 'C', 'D', 'E'].map(cat => (
                                          <option key={cat} value={cat}>{cat}</option>
                                      ))}
                                  </select>
                              </div>
                              <div className="flex items-center gap-2">
                                  <label className="text-sm text-muted-foreground font-medium">Source:</label>
                                  <select 
                                      value={resultSource}
                                      onChange={(e) => setResultSource(e.target.value as any)}
                                      className="bg-background border border-input rounded px-2 py-1 text-sm font-medium text-foreground focus:ring-1 focus:ring-primary"
                                  >
                                      <option value="finishers">Finishers</option>
                                      <option value="joined">Joined</option>
                                      <option value="signed_up">Signed Up</option>
                                  </select>
                              </div>
                              <label className="flex items-center gap-2 cursor-pointer border-l border-border pl-4">
                                  <input 
                                      type="checkbox"
                                      checked={filterRegistered}
                                      onChange={(e) => setFilterRegistered(e.target.checked)}
                                      className="w-4 h-4 rounded border-input text-primary focus:ring-primary"
                                  />
                                  <span className="text-sm text-muted-foreground select-none">Filter Registered</span>
                              </label>
                          </div>
                      </div>
                  </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-muted/50 text-muted-foreground">
                        <tr>
                            <th className="px-6 py-3">Date</th>
                            <th className="px-6 py-3">Name</th>
                            <th className="px-6 py-3">Route</th>
                            <th className="px-6 py-3">Sprints</th>
                            <th className="px-6 py-3 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {races.map(r => (
                            <tr key={r.id} className={editingRaceId === r.id ? 'bg-primary/5' : 'hover:bg-muted/20 transition'}>
                                <td className="px-6 py-4 text-card-foreground whitespace-nowrap">
                                    {new Date(r.date).toLocaleDateString()} <span className="text-muted-foreground">{new Date(r.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                </td>
                                <td className="px-6 py-4 font-medium text-card-foreground">{r.name}</td>
                                <td className="px-6 py-4 text-muted-foreground">
                                    <div className="font-medium text-card-foreground">{r.map}</div>
                                    <div className="text-xs">{r.routeName} ({r.laps} laps)</div>
                                    {r.eventId && <div className="text-xs text-primary/70">Event ID: {r.eventId}</div>}
                                </td>
                                <td className="px-6 py-4 text-muted-foreground">
                                    {r.sprints ? r.sprints.length : (r.selectedSegments ? r.selectedSegments.length : 0)} selected
                                </td>
                                <td className="px-6 py-4 text-right space-x-2 whitespace-nowrap">
                                    {r.eventId && (
                                        <button 
                                            onClick={() => handleRefreshResults(r.id)}
                                            disabled={status === 'refreshing'}
                                            className="text-green-600 hover:text-green-700 dark:text-green-400 font-medium px-2 py-1"
                                        >
                                            Results
                                        </button>
                                    )}
                                    <button 
                                        onClick={() => handleEdit(r)}
                                        className="text-primary hover:text-primary/80 font-medium px-2 py-1"
                                    >
                                        Edit
                                    </button>
                                    <button 
                                        onClick={() => handleDeleteRace(r.id)}
                                        className="text-destructive hover:text-destructive/80 font-medium px-2 py-1"
                                    >
                                        Delete
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {races.length === 0 && (
                            <tr>
                                <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">No races scheduled.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
              </div>
          </div>
        </>
      )}
    </div>
  );
}

