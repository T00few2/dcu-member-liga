'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';

interface CategoryConfig {
  category: string;
  laps?: number;
  sprints?: Sprint[];
  segmentType?: 'sprint' | 'split';
}

interface Race {
  id: string;
  name: string;
  date: string;
  routeId: string;
  routeName: string;
  map: string;
  laps: number;
  eventId?: string;
  eventMode?: 'single' | 'multi';
  eventConfiguration?: {
    eventId: string;
    eventSecret: string;
    customCategory: string;
    laps?: number; // Added laps override
    sprints?: Sprint[]; // Added support for per-category sprints
  }[];
  singleModeCategories?: CategoryConfig[]; // Per-category config for single mode
  results?: Record<string, ResultEntry[]>;
  resultsUpdatedAt?: string;
  sprints?: Sprint[];
  sprintData?: Sprint[];
}

interface Sprint {
    id: string;
    name: string;
    count: number;
    direction: string;
    lap: number;
    key: string;
}

interface ResultEntry {
    zwiftId: string;
    name: string;
    finishTime: number;
    finishRank: number;
    finishPoints: number;
    sprintPoints: number;
    totalPoints: number;
    sprintDetails: Record<string, number>;
}

interface StandingEntry {
    zwiftId: string;
    name: string;
    totalPoints: number;
    raceCount: number;
    results: { raceId: string, points: number }[];
}

export default function ResultsPage() {
  const { user, loading: authLoading, isRegistered } = useAuth();
  const router = useRouter();
  
  const [races, setRaces] = useState<Race[]>([]);
  const [standings, setStandings] = useState<Record<string, StandingEntry[]>>({});
  const [loading, setLoading] = useState(true);
  
  // UI State
  const [activeTab, setActiveTab] = useState<'standings' | 'results'>('standings');
  const [selectedRaceId, setSelectedRaceId] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('A');
  
  // Standings UI State
  const [standingsCategory, setStandingsCategory] = useState<string>('A');
  const [bestRacesCount, setBestRacesCount] = useState<number>(5);

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

  // Fetch Data
  useEffect(() => {
    const fetchData = async () => {
        if (!user) return;
        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
            const token = await user.getIdToken();
            
            // Fetch Races
            const racesRes = await fetch(`${apiUrl}/races`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            // Fetch Standings
            const [standingsRes, settingsRes] = await Promise.all([
                fetch(`${apiUrl}/league/standings`, { headers: { 'Authorization': `Bearer ${token}` } }),
                fetch(`${apiUrl}/league/settings`, { headers: { 'Authorization': `Bearer ${token}` } })
            ]);

            if (settingsRes.ok) {
                const settingsData = await settingsRes.json();
                if (settingsData.settings?.bestRacesCount) {
                    setBestRacesCount(settingsData.settings.bestRacesCount);
                }
            }

            if (racesRes.ok) {
                const data = await racesRes.json();
                const sorted = (data.races || []).sort((a: Race, b: Race) => 
                    new Date(a.date).getTime() - new Date(b.date).getTime()
                );
                setRaces(sorted);
                if (sorted.length > 0) {
                    setSelectedRaceId(sorted[0].id);
                }
            }
            
            if (standingsRes.ok) {
                const data = await standingsRes.json();
                setStandings(data.standings || {});
                // Set initial standings category if available
                const cats = Object.keys(data.standings || {});
                if (cats.length > 0 && !cats.includes(standingsCategory)) {
                    setStandingsCategory(cats.sort()[0]);
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

  // Live Updates for Selected Race
  useEffect(() => {
      if (!selectedRaceId || activeTab !== 'results') return;

      // Subscribe to the race document for real-time updates
      const unsubscribe = onSnapshot(doc(db, 'races', selectedRaceId), (docSnapshot) => {
          if (docSnapshot.exists()) {
              const updatedData = docSnapshot.data();
              const updatedRace = { ...updatedData, id: docSnapshot.id } as Race;
              
              setRaces(prev => prev.map(r => r.id === updatedRace.id ? { ...r, ...updatedRace } : r));
          }
      }, (error) => {
          console.error("Error listening to race updates:", error);
      });

      return () => unsubscribe();
  }, [selectedRaceId, activeTab]);

  // Live Updates for Standings
  useEffect(() => {
      // Subscribe to the league standings document
      const unsubscribe = onSnapshot(doc(db, 'league', 'standings'), (docSnapshot) => {
          if (docSnapshot.exists()) {
              const data = docSnapshot.data();
              if (data.standings) {
                  setStandings(data.standings);
              }
          }
      }, (error) => {
          console.error("Error listening to standings updates:", error);
      });

      return () => unsubscribe();
  }, []);

  const formatTime = (ms: number) => {
      if (!ms) return '-';
      const totalSeconds = Math.floor(ms / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      const millis = ms % 1000;
      
      const pad = (n: number) => n.toString().padStart(2, '0');
      const padMs = (n: number) => n.toString().padStart(3, '0');
      
      if (hours > 0) {
          return `${hours}:${pad(minutes)}:${pad(seconds)}.${padMs(millis)}`;
      }
      return `${pad(minutes)}:${pad(seconds)}.${padMs(millis)}`;
  };

  if (authLoading || loading) return <div className="p-8 text-center text-muted-foreground">Loading results...</div>;

  // --- Derived Data ---
  
  // Race Results Data
  const selectedRace = races.find(r => r.id === selectedRaceId);
  
  // Sort available categories
  let availableRaceCategories: string[] = [];
  
  if (selectedRace?.results && Object.keys(selectedRace.results).length > 0) {
      availableRaceCategories = Object.keys(selectedRace.results);
  } else if (selectedRace?.eventMode === 'multi' && selectedRace.eventConfiguration) {
      // Use configured categories if no results yet
      availableRaceCategories = selectedRace.eventConfiguration
          .map(c => c.customCategory)
          .filter(Boolean);
  } else if (selectedRace?.singleModeCategories && selectedRace.singleModeCategories.length > 0) {
      // Use configured single mode categories if no results yet
      availableRaceCategories = selectedRace.singleModeCategories
          .map(c => c.category)
          .filter(Boolean);
  } else {
      // Fallback default
      availableRaceCategories = ['A', 'B', 'C', 'D', 'E'];
  }

  if (selectedRace?.eventMode === 'multi' && selectedRace.eventConfiguration) {
      // Create a map of category -> index
      const orderMap = new Map();
      selectedRace.eventConfiguration.forEach((cfg, idx) => {
          if (cfg.customCategory) orderMap.set(cfg.customCategory, idx);
      });
      
      availableRaceCategories.sort((a, b) => {
          const idxA = orderMap.has(a) ? orderMap.get(a) : 999;
          const idxB = orderMap.has(b) ? orderMap.get(b) : 999;
          return idxA - idxB;
      });
  } else if (selectedRace?.singleModeCategories && selectedRace.singleModeCategories.length > 0) {
      // Use order from singleModeCategories
      const orderMap = new Map();
      selectedRace.singleModeCategories.forEach((cfg, idx) => {
          if (cfg.category) orderMap.set(cfg.category, idx);
      });
      
      availableRaceCategories.sort((a, b) => {
          const idxA = orderMap.has(a) ? orderMap.get(a) : 999;
          const idxB = orderMap.has(b) ? orderMap.get(b) : 999;
          return idxA - idxB;
      });
  } else {
      availableRaceCategories.sort();
  }

  const displayRaceCategory = (selectedRace?.results && !availableRaceCategories.includes(selectedCategory) && availableRaceCategories.length > 0)
      ? availableRaceCategories[0]
      : selectedCategory;
  const raceResults = selectedRace?.results?.[displayRaceCategory] || [];

  // Determine laps for display
  // If multi-event, look for specific category config overrides
  let displayLaps = selectedRace?.laps;
  if (selectedRace?.eventMode === 'multi' && selectedRace.eventConfiguration) {
      const config = selectedRace.eventConfiguration.find(c => c.customCategory === displayRaceCategory);
      if (config && config.laps) {
          displayLaps = config.laps;
      }
  } else if (selectedRace?.singleModeCategories && selectedRace.singleModeCategories.length > 0) {
      // Check single mode category config for laps override
      const config = selectedRace.singleModeCategories.find(c => c.category === displayRaceCategory);
      if (config && config.laps) {
          displayLaps = config.laps;
      }
  }
  // Standings Data
  let availableStandingsCategories = Object.keys(standings).length > 0 
      ? Object.keys(standings)
      : ['A', 'B', 'C', 'D', 'E'];

  // Apply custom sorting based on the latest race configuration
  const referenceRace = [...races].reverse().find(r => r.eventMode === 'multi' && r.eventConfiguration && r.eventConfiguration.length > 0);
  
  if (referenceRace && referenceRace.eventConfiguration) {
      const orderMap = new Map();
      referenceRace.eventConfiguration.forEach((cfg, idx) => {
          if (cfg.customCategory) orderMap.set(cfg.customCategory, idx);
      });
      
      availableStandingsCategories.sort((a, b) => {
          const idxA = orderMap.has(a) ? orderMap.get(a) : 999;
          const idxB = orderMap.has(b) ? orderMap.get(b) : 999;
          if (idxA === idxB) return a.localeCompare(b);
          return idxA - idxB;
      });
  } else {
      availableStandingsCategories.sort();
  }

  const displayStandingsCategory = (Object.keys(standings).length > 0 && !availableStandingsCategories.includes(standingsCategory))
      ? availableStandingsCategories[0]
      : standingsCategory;
  
  // Calculate standings with only best X races counting
  const rawStandings = standings[displayStandingsCategory] || [];
  
  // Process each rider to calculate best races
  const processedStandings = rawStandings.map(rider => {
      // Sort results by points descending and take top N
      const sortedResults = [...rider.results].sort((a, b) => b.points - a.points);
      const countingRaceIds = new Set(sortedResults.slice(0, bestRacesCount).map(r => r.raceId));
      const bestTotal = sortedResults.slice(0, bestRacesCount).reduce((sum, r) => sum + r.points, 0);
      
      return {
          ...rider,
          calculatedTotal: bestTotal,
          countingRaceIds
      };
  });
  
  // Re-sort standings by the new calculated total
  const currentStandings = processedStandings.sort((a, b) => b.calculatedTotal - a.calculatedTotal);

  // Extract all unique sprint keys (if any) from the results to build dynamic columns
  const allSprintKeys = new Set<string>();
  if (raceResults.length > 0) {
      raceResults.forEach(r => {
          if (r.sprintDetails) {
              Object.keys(r.sprintDetails).forEach(k => allSprintKeys.add(k));
          }
      });
  }

  // Sort keys: prefer chronological order from sprintData, fallback to alphabetical
  let sprintColumns: string[] = [];
  
  if (selectedRace) {
      // Determine correct sprint config source
      let orderedSprints: Sprint[] = [];
      
      if (selectedRace.eventMode === 'multi' && selectedRace.eventConfiguration) {
          // Find config for current category
          const catConfig = selectedRace.eventConfiguration.find(c => c.customCategory === displayRaceCategory);
          if (catConfig && catConfig.sprints) {
              orderedSprints = catConfig.sprints;
          } else {
               // Fallback to global if not found
               orderedSprints = selectedRace.sprints || [];
          }
      } else {
          // Single Mode - check for per-category config
          if (selectedRace.singleModeCategories && selectedRace.singleModeCategories.length > 0) {
              const catConfig = selectedRace.singleModeCategories.find(c => c.category === displayRaceCategory);
              if (catConfig && catConfig.sprints) {
                  orderedSprints = catConfig.sprints;
              } else {
                  // Fallback to global sprints
                  orderedSprints = selectedRace.sprintData || selectedRace.sprints || [];
              }
          } else {
              // Legacy: no per-category config
              orderedSprints = selectedRace.sprintData || selectedRace.sprints || [];
          }
      }
      
      if (orderedSprints.length > 0) {
          // Iterate through defined sprints in order and pick those that have results
          orderedSprints.forEach(s => {
              // Check potential keys for this sprint
              const potentialKeys = [s.key, `${s.id}_${s.count}`, `${s.id}`];
              
              // Find the one that actually exists in our results
              const foundKey = potentialKeys.find(k => allSprintKeys.has(k));
              
              if (foundKey) {
                  sprintColumns.push(foundKey);
                  // Remove from set to track what's left
                  allSprintKeys.delete(foundKey);
              }
          });
      }
  }

  // Append any remaining keys that weren't in the ordered list (sorted alphabetically)
  if (allSprintKeys.size > 0) {
      const remaining = Array.from(allSprintKeys).sort();
      sprintColumns = [...sprintColumns, ...remaining];
  }

  const getSprintHeader = (key: string) => {
      // Find source sprint list again (could refactor to share)
      let sourceSprints: Sprint[] = [];
       if (selectedRace?.eventMode === 'multi' && selectedRace.eventConfiguration) {
          const catConfig = selectedRace.eventConfiguration.find(c => c.customCategory === displayRaceCategory);
          if (catConfig && catConfig.sprints) sourceSprints = catConfig.sprints;
          else sourceSprints = selectedRace.sprints || [];
       } else if (selectedRace?.singleModeCategories && selectedRace.singleModeCategories.length > 0) {
          // Check single mode category config for sprints
          const catConfig = selectedRace.singleModeCategories.find(c => c.category === displayRaceCategory);
          if (catConfig && catConfig.sprints) sourceSprints = catConfig.sprints;
          else sourceSprints = selectedRace?.sprints || [];
       } else {
          sourceSprints = selectedRace?.sprints || [];
       }
      
      if (sourceSprints.length === 0) return key.replace(/_/g, ' ');

      // Try matching key, ID_COUNT, or just ID
      const sprint = sourceSprints.find(s => s.key === key || `${s.id}_${s.count}` === key || s.id === key);
      
      if (sprint) {
          return `${sprint.name} #${sprint.count}`;
      }
      // Fallback: try to look up by ID/Count parsing if key format is ID_COUNT
      const parts = key.split('_');
      if (parts.length >= 2) {
          const id = parts[0];
          const count = parseInt(parts[1]);
          const match = sourceSprints.find(s => s.id == id && s.count == count);
          if (match) return `${match.name} #${match.count}`;
      }
      return key.replace(/_/g, ' ');
  };

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
          <div className="space-y-6">
              <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-semibold text-card-foreground">Leaderboard</h2>
                  <div className="flex gap-2 bg-muted/20 rounded p-1 overflow-x-auto">
                      {availableStandingsCategories.map(cat => (
                          <button
                              key={cat}
                              onClick={() => setStandingsCategory(cat)}
                              className={`px-3 py-1 text-sm rounded transition-colors whitespace-nowrap ${
                                  displayStandingsCategory === cat 
                                  ? 'bg-primary text-primary-foreground shadow-sm' 
                                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                              }`}
                          >
                              {cat}
                          </button>
                      ))}
                  </div>
              </div>

              <div className="bg-card border border-border rounded-lg overflow-hidden shadow-sm">
                  {currentStandings.length > 0 ? (
                      <div className="overflow-x-auto">
                          <table className="w-full text-left text-sm whitespace-nowrap">
                              <thead className="bg-muted/50 text-muted-foreground">
                                  <tr>
                                      <th className="px-4 py-3 w-12 text-center">Rank</th>
                                      <th className="px-4 py-3">Rider</th>
                                      <th className="px-4 py-3 text-center">Races</th>
                                      {races.map((race) => (
                                          <th key={race.id} className="px-2 py-3 text-center text-xs font-medium text-muted-foreground whitespace-normal min-w-[60px]" title={new Date(race.date).toLocaleDateString('da-DK', { day: '2-digit', month: '2-digit', year: 'numeric' })}>
                                              {race.name}
                                          </th>
                                      ))}
                                      <th className="px-4 py-3 text-right font-bold text-primary">Total Points</th>
                                  </tr>
                              </thead>
                              <tbody className="divide-y divide-border">
                                  {currentStandings.map((rider, idx) => (
                                      <tr key={rider.zwiftId} className="hover:bg-muted/20 transition">
                                          <td className="px-4 py-3 text-center font-medium text-muted-foreground">
                                              {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                                          </td>
                                          <td className="px-4 py-3 font-medium text-card-foreground">{rider.name}</td>
                                          <td className="px-4 py-3 text-center text-muted-foreground">{rider.raceCount}</td>
                                          {races.map(race => {
                                              const result = rider.results.find(r => r.raceId === race.id);
                                              const isCounting = rider.countingRaceIds.has(race.id);
                                              return (
                                                  <td 
                                                      key={race.id} 
                                                      className={`px-2 py-3 text-center text-sm ${
                                                          result 
                                                              ? isCounting 
                                                                  ? 'text-foreground font-medium' 
                                                                  : 'text-muted-foreground/50 line-through'
                                                              : 'text-muted-foreground'
                                                      }`}
                                                      title={result && !isCounting ? 'Not counting (outside best 5)' : undefined}
                                                  >
                                                      {result ? result.points : '-'}
                                                  </td>
                                              );
                                          })}
                                          <td className="px-4 py-3 text-right font-bold text-foreground text-lg">{rider.calculatedTotal}</td>
                                      </tr>
                                  ))}
                              </tbody>
                          </table>
                      </div>
                  ) : (
                      <div className="p-12 text-center text-muted-foreground">
                          No standings available yet.
                      </div>
                  )}
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
                                  {new Date(r.date).toLocaleDateString('da-DK', { day: '2-digit', month: '2-digit', year: 'numeric' })} - {r.name}
                              </option>
                          ))}
                          {races.length === 0 && <option>No races found</option>}
                      </select>
                  </div>
                  
                  {selectedRace && (
                      <div className="text-right hidden sm:block">
                          <div className="text-sm font-medium text-card-foreground">{selectedRace.map}</div>
                          <div className="text-xs text-muted-foreground">{selectedRace.routeName} • {displayLaps} laps</div>
                      </div>
                  )}
              </div>

              {/* Category Tabs */}
              <div className="flex gap-2 border-b border-border pb-1 overflow-x-auto">
                  {availableRaceCategories.map(cat => (
                      <button
                          key={cat}
                          onClick={() => setSelectedCategory(cat)}
                          className={`px-4 py-2 rounded-t-md font-bold text-sm transition-colors whitespace-nowrap ${
                              displayRaceCategory === cat 
                              ? 'bg-primary text-primary-foreground' 
                              : 'bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                          }`}
                      >
                          {cat}
                      </button>
                  ))}
              </div>

              {/* Results Table */}
              <div className="bg-card border border-border rounded-lg overflow-hidden shadow-sm">
                  {raceResults.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-muted/50 text-muted-foreground">
                                <tr>
                                    <th className="px-4 py-3 w-12 text-center">Pos</th>
                                    <th className="px-4 py-3">Rider</th>
                                    <th className="px-4 py-3 text-right">Time</th>
                                    {/* Dynamic Sprint Columns */}
                                    {sprintColumns.map(sprintKey => (
                                        <th 
                                            key={sprintKey} 
                                            className="px-2 py-3 text-center text-xs uppercase tracking-wider text-muted-foreground/70 whitespace-normal sm:max-w-[120px] min-w-[80px]"
                                        >
                                            {getSprintHeader(sprintKey)}
                                        </th>
                                    ))}
                                    <th className="px-4 py-3 text-right text-muted-foreground/70">Finish Pts</th>
                                    <th className="px-4 py-3 text-right font-bold text-primary">Total Pts</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {raceResults.map((rider, idx) => (
                                    <tr key={rider.zwiftId} className="hover:bg-muted/20 transition">
                                        <td className="px-4 py-3 text-center font-medium text-muted-foreground">{idx + 1}</td>
                                        <td className="px-4 py-3 font-medium text-card-foreground">{rider.name}</td>
                                        <td className="px-4 py-3 text-right font-mono text-muted-foreground">{formatTime(rider.finishTime)}</td>
                                        {/* Dynamic Sprint Data */}
                                        {sprintColumns.map(sprintKey => (
                                            <td key={sprintKey} className="px-4 py-3 text-center text-muted-foreground">
                                                {rider.sprintDetails?.[sprintKey] || '-'}
                                            </td>
                                        ))}
                                        <td className="px-4 py-3 text-right text-muted-foreground font-medium">{rider.finishPoints}</td>
                                        <td className="px-4 py-3 text-right font-bold text-foreground">{rider.totalPoints}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                      </div>
                  ) : (
                      <div className="p-12 text-center">
                          <p className="text-muted-foreground mb-4">
                              No results available for <span className="font-semibold text-foreground">{selectedRace?.name}</span> ({displayRaceCategory})
                          </p>
                          {selectedRace?.eventId || (selectedRace?.eventConfiguration && selectedRace.eventConfiguration.length > 0) ? (
                              <div className="inline-block px-4 py-2 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded text-sm">
                                  Results processing is pending or incomplete. Check back later.
                              </div>
                          ) : (
                              <div className="inline-block px-4 py-2 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded text-sm">
                                  Event ID not yet linked. Results cannot be fetched.
                              </div>
                          )}
                      </div>
                  )}
              </div>
          </div>
      )}
    </div>
  );
}
