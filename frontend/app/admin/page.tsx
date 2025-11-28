'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';

interface Route {
  id: string;
  name: string;
  map: string;
  distance: number;
  elevation: number;
  leadinDistance: number;
  leadinElevation: number;
}

interface Race {
  id: string;
  name: string;
  date: string; // YYYY-MM-DDTHH:MM
  routeId: string;
  routeName: string;
  map: string;
  laps: number;
  totalDistance: number;
  totalElevation: number;
}

export default function AdminPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  
  const [routes, setRoutes] = useState<Route[]>([]);
  const [races, setRaces] = useState<Race[]>([]);
  
  // Form State
  const [editingRaceId, setEditingRaceId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [selectedMap, setSelectedMap] = useState('');
  const [selectedRouteId, setSelectedRouteId] = useState('');
  const [laps, setLaps] = useState(1);
  
  const [status, setStatus] = useState<'idle' | 'loading' | 'saving'>('idle');
  const [error, setError] = useState('');

  // Access Control
  useEffect(() => {
    if (!authLoading && !user) {
        router.push('/');
    }
  }, [user, authLoading, router]);

  // Fetch Data
  useEffect(() => {
    const fetchData = async () => {
        if (!user) return;
        setStatus('loading');
        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
            const token = await user.getIdToken();
            
            // 1. Fetch Routes
            const routesRes = await fetch(`${apiUrl}/routes`);
            const routesData = await routesRes.json();
            setRoutes(routesData.routes || []);

            // 2. Fetch Races
            const racesRes = await fetch(`${apiUrl}/races`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (racesRes.ok) {
                const racesData = await racesRes.json();
                setRaces(racesData.races || []);
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

  // Derived Data for Form
  const maps = Array.from(new Set(routes.map(r => r.map))).sort();
  const filteredRoutes = selectedMap ? routes.filter(r => r.map === selectedMap) : [];
  const selectedRoute = routes.find(r => r.id === selectedRouteId);

  // Calculations
  const calcDistance = selectedRoute 
    ? (selectedRoute.distance * laps + selectedRoute.leadinDistance).toFixed(1) 
    : '0';
    
  const calcElevation = selectedRoute
    ? Math.round(selectedRoute.elevation * laps + selectedRoute.leadinElevation)
    : 0;

  const handleEdit = (race: Race) => {
      setEditingRaceId(race.id);
      setName(race.name);
      setDate(race.date);
      setSelectedMap(race.map);
      setSelectedRouteId(race.routeId);
      setLaps(race.laps);
      
      // Scroll to top
      window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancel = () => {
      setEditingRaceId(null);
      setName('');
      setDate('');
      setSelectedMap('');
      setSelectedRouteId('');
      setLaps(1);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedRoute) return;
    
    setStatus('saving');
    try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
        const token = await user.getIdToken();
        
        const raceData = {
            name,
            date,
            routeId: selectedRoute.id,
            routeName: selectedRoute.name,
            map: selectedRoute.map,
            laps,
            totalDistance: Number(calcDistance),
            totalElevation: Number(calcElevation)
        };
        
        if (editingRaceId) {
            // UPDATE (PUT)
            const res = await fetch(`${apiUrl}/races/${editingRaceId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(raceData)
            });
            
            if (res.ok) {
                setRaces(races.map(r => r.id === editingRaceId ? { ...raceData, id: editingRaceId } : r));
                handleCancel(); // Reset form
            } else {
                const err = await res.json();
                alert(`Error: ${err.message}`);
            }
        } else {
            // CREATE (POST)
            const res = await fetch(`${apiUrl}/races`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(raceData)
            });
            
            if (res.ok) {
                const data = await res.json();
                setRaces([...races, { ...raceData, id: data.id }]);
                handleCancel(); // Reset form
            } else {
                const err = await res.json();
                alert(`Error: ${err.message}`);
            }
        }
    } catch (e) {
        alert('Failed to save race');
    } finally {
        setStatus('idle');
    }
  };

  const handleDelete = async (id: string) => {
      if (!user || !confirm('Are you sure you want to delete this race?')) return;
      
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
        const token = await user.getIdToken();
        
        const res = await fetch(`${apiUrl}/races/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (res.ok) {
            setRaces(races.filter(r => r.id !== id));
        }
      } catch (e) {
          alert('Failed to delete');
      }
  };

  if (authLoading || status === 'loading') return <div className="p-8 text-center">Loading...</div>;

  return (
    <div className="max-w-4xl mx-auto mt-8 px-4">
      <h1 className="text-3xl font-bold mb-8 text-foreground">League Administration</h1>
      
      {/* Create/Edit Race Form */}
      <div className="bg-card p-6 rounded-lg shadow mb-8 border border-border">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-card-foreground">
                {editingRaceId ? 'Edit Scheduled Race' : 'Schedule New Race'}
            </h2>
            {editingRaceId && (
                <button onClick={handleCancel} className="text-sm text-muted-foreground hover:text-foreground">
                    Cancel Edit
                </button>
            )}
          </div>
          
          <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                      <label className="block text-sm font-medium text-muted-foreground mb-1">Select Map</label>
                      <select 
                        value={selectedMap}
                        onChange={e => {
                            setSelectedMap(e.target.value);
                            setSelectedRouteId(''); // Reset route when map changes
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
                  <div>
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
                  <div className="p-4 bg-muted/50 rounded-lg border border-border text-sm grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
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
                      <div className="text-card-foreground">
                          <strong>Total Distance:</strong> {calcDistance} km
                      </div>
                      <div className="text-card-foreground">
                          <strong>Total Elevation:</strong> {calcElevation} m
                      </div>
                  </div>
              )}

              <div className="flex gap-3">
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

      {/* Existing Races */}
      <div className="bg-card rounded-lg shadow overflow-hidden border border-border">
          <h2 className="text-xl font-semibold p-6 border-b border-border text-card-foreground">Scheduled Races</h2>
          <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                      <th className="px-6 py-3">Date</th>
                      <th className="px-6 py-3">Name</th>
                      <th className="px-6 py-3">Map/Route</th>
                      <th className="px-6 py-3">Details</th>
                      <th className="px-6 py-3 text-right">Actions</th>
                  </tr>
              </thead>
              <tbody className="divide-y divide-border">
                  {races.map(r => (
                      <tr key={r.id} className={editingRaceId === r.id ? 'bg-primary/5' : ''}>
                          <td className="px-6 py-4 text-card-foreground">
                              {new Date(r.date).toLocaleString()}
                          </td>
                          <td className="px-6 py-4 font-medium text-card-foreground">{r.name}</td>
                          <td className="px-6 py-4 text-muted-foreground">
                              <div className="font-medium text-card-foreground">{r.map}</div>
                              <div className="text-xs">{r.routeName}</div>
                          </td>
                          <td className="px-6 py-4 text-muted-foreground">
                              {r.laps} laps • {r.totalDistance}km • {r.totalElevation}m
                          </td>
                          <td className="px-6 py-4 text-right space-x-2">
                              <button 
                                onClick={() => handleEdit(r)}
                                className="text-primary hover:text-primary/80 px-2 py-1 rounded transition"
                              >
                                  Edit
                              </button>
                              <button 
                                onClick={() => handleDelete(r.id)}
                                className="text-destructive hover:text-destructive-foreground hover:bg-destructive/10 px-2 py-1 rounded transition"
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
  );
}
