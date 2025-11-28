'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';

interface Race {
  id: string;
  name: string;
  date: string;
  routeId: string;
  routeName: string;
  map: string;
  laps: number;
  eventId?: string;
}

export default function ResultsPage() {
  const { user, loading: authLoading, isRegistered } = useAuth();
  const router = useRouter();
  
  const [races, setRaces] = useState<Race[]>([]);
  const [loading, setLoading] = useState(true);
  
  // UI State
  const [activeTab, setActiveTab] = useState<'standings' | 'results'>('standings');
  const [selectedRaceId, setSelectedRaceId] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('A');

  // Access Control
  useEffect(() => {
    if (!authLoading) {
        if (!user) {
            router.push('/');
        } else if (!isRegistered) {
            router.push('/register');
        }
    }
  }, [user, authLoading, isRegistered, router]);

  // Fetch Races
  useEffect(() => {
    const fetchRaces = async () => {
        if (!user) return;
        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
            const token = await user.getIdToken();
            const res = await fetch(`${apiUrl}/races`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                const sorted = (data.races || []).sort((a: Race, b: Race) => 
                    new Date(b.date).getTime() - new Date(a.date).getTime() // Newest first
                );
                setRaces(sorted);
                if (sorted.length > 0) {
                    setSelectedRaceId(sorted[0].id);
                }
            }
        } catch (e) {
            console.error('Error fetching races', e);
        } finally {
            setLoading(false);
        }
    };

    if (user && isRegistered) {
        fetchRaces();
    }
  }, [user, isRegistered]);

  if (authLoading || loading) return <div className="p-8 text-center text-muted-foreground">Loading results...</div>;

  const selectedRace = races.find(r => r.id === selectedRaceId);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8 text-foreground">Results & Standings</h1>
      
      {/* Main Tabs */}
      <div className="flex gap-4 mb-8 border-b border-border">
          <button 
            onClick={() => setActiveTab('standings')}
            className={`pb-2 px-4 font-medium transition ${activeTab === 'standings' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
          >
              League Standings
          </button>
          <button 
            onClick={() => setActiveTab('results')}
            className={`pb-2 px-4 font-medium transition ${activeTab === 'results' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
          >
              Race Results
          </button>
      </div>

      {/* LEAGUE STANDINGS TAB */}
      {activeTab === 'standings' && (
          <div className="bg-card border border-border rounded-lg p-8 text-center shadow-sm">
              <div className="max-w-md mx-auto">
                  <h2 className="text-xl font-semibold text-card-foreground mb-2">Overall Standings</h2>
                  <p className="text-muted-foreground">League standings will be calculated once race results are available.</p>
                  {/* Placeholder for Standings Table */}
              </div>
          </div>
      )}

      {/* RACE RESULTS TAB */}
      {activeTab === 'results' && (
          <div className="space-y-6">
              {/* Race Selector */}
              <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between bg-card border border-border p-4 rounded-lg shadow-sm">
                  <div className="flex flex-col gap-1 w-full sm:w-auto">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Select Race</label>
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
                          {races.length === 0 && <option>No races found</option>}
                      </select>
                  </div>
                  
                  {selectedRace && (
                      <div className="text-right hidden sm:block">
                          <div className="text-sm font-medium text-card-foreground">{selectedRace.map}</div>
                          <div className="text-xs text-muted-foreground">{selectedRace.routeName} • {selectedRace.laps} laps</div>
                      </div>
                  )}
              </div>

              {/* Category Tabs */}
              <div className="flex gap-2 border-b border-border pb-1 overflow-x-auto">
                  {['A', 'B', 'C', 'D', 'E'].map(cat => (
                      <button
                          key={cat}
                          onClick={() => setSelectedCategory(cat)}
                          className={`px-4 py-2 rounded-t-md font-bold text-sm transition-colors ${
                              selectedCategory === cat 
                              ? 'bg-primary text-primary-foreground' 
                              : 'bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                          }`}
                      >
                          Category {cat}
                      </button>
                  ))}
              </div>

              {/* Results Table Placeholder */}
              <div className="bg-card border border-border rounded-lg overflow-hidden shadow-sm">
                  <div className="p-8 text-center">
                      <p className="text-muted-foreground mb-4">
                          Results for <span className="font-semibold text-foreground">{selectedRace?.name}</span> (Category {selectedCategory})
                      </p>
                      {selectedRace?.eventId ? (
                          <div className="inline-block px-4 py-2 bg-green-500/10 text-green-600 dark:text-green-400 rounded text-sm">
                              Event ID linked: {selectedRace.eventId}. Processing pending.
                          </div>
                      ) : (
                          <div className="inline-block px-4 py-2 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded text-sm">
                              No Event ID linked for this race.
                          </div>
                      )}
                  </div>
                  
                  {/* Example Table Header (for layout preview) */}
                  <div className="overflow-x-auto opacity-50 pointer-events-none blur-[1px]">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-muted/50 text-muted-foreground">
                            <tr>
                                <th className="px-4 py-3">Pos</th>
                                <th className="px-4 py-3">Rider</th>
                                <th className="px-4 py-3 text-right">Time</th>
                                <th className="px-4 py-3 text-right">Finish Pts</th>
                                <th className="px-4 py-3 text-right">Sprint Pts</th>
                                <th className="px-4 py-3 text-right font-bold">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {[1,2,3].map(i => (
                                <tr key={i} className="border-t border-border">
                                    <td className="px-4 py-3">{i}</td>
                                    <td className="px-4 py-3">Rider Name</td>
                                    <td className="px-4 py-3 text-right">45:00</td>
                                    <td className="px-4 py-3 text-right">100</td>
                                    <td className="px-4 py-3 text-right">20</td>
                                    <td className="px-4 py-3 text-right font-bold">120</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}
