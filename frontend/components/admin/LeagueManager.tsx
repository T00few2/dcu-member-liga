'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';

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
    type?: 'sprint' | 'split';
}

interface CategoryConfig {
  category: string; // e.g. "A", "B", or "Elite Men"
  laps?: number;
  sprints?: SelectedSegment[];
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
  totalDistance: number;
  totalElevation: number;
  eventId?: string; // Legacy/Single Mode
  eventSecret?: string; // Legacy/Single Mode
  eventMode?: 'single' | 'multi';
  linkedEventIds?: string[]; // New searchable index
  eventConfiguration?: {
    eventId: string;
    eventSecret: string;
    customCategory: string; // e.g. "Elite Men"
    laps?: number; // Override Laps
    startTime?: string; // Override Start Time (ISO string or Time string)
    sprints?: SelectedSegment[]; // New: Per-category sprints
    segmentType?: 'sprint' | 'split';
  }[];
  singleModeCategories?: CategoryConfig[]; // Per-category config for single mode
  selectedSegments?: string[]; // List of segment unique keys (id_count) - KEPT FOR BACKWARDS COMPAT
  sprints?: SelectedSegment[]; // Full segment objects (Legacy/Global)
  segmentType?: 'sprint' | 'split';
  results?: Record<string, any[]>; // Store results by category
  manualDQs?: string[]; // Manually Disqualified Zwift IDs
  manualDeclassifications?: string[]; // Manually Declassified Zwift IDs
}

interface LeagueSettings {
  finishPoints: number[];
  sprintPoints: number[];
  bestRacesCount: number; // Added field
}

export default function LeagueManager() {
  const { user, loading: authLoading } = useAuth();
  
  // Data State
  const [routes, setRoutes] = useState<Route[]>([]);
  const [races, setRaces] = useState<Race[]>([]);
  const [availableSegments, setAvailableSegments] = useState<Segment[]>([]);
  const [leagueSettings, setLeagueSettings] = useState<LeagueSettings>({ finishPoints: [], sprintPoints: [], bestRacesCount: 5 });
  
  // Tabs
  const [activeTab, setActiveTab] = useState<'races' | 'settings' | 'testing'>('races');

  // Results View State
  const [viewingResultsId, setViewingResultsId] = useState<string | null>(null);

  // Race Form State
  const [editingRaceId, setEditingRaceId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  
  // Single Mode State
  const [eventId, setEventId] = useState('');
  const [eventSecret, setEventSecret] = useState('');
  
  // Multi Mode State
  const [eventMode, setEventMode] = useState<'single' | 'multi'>('single');
  const [eventConfiguration, setEventConfiguration] = useState<{
      eventId: string, 
      eventSecret: string, 
      customCategory: string,
      laps?: number,
      startTime?: string,
      sprints?: SelectedSegment[],
      segmentType?: 'sprint' | 'split'
  }[]>([]);

  // Single Mode Category Configuration (for per-category laps/sprints)
  const [singleModeCategories, setSingleModeCategories] = useState<CategoryConfig[]>([]);

  const [selectedMap, setSelectedMap] = useState('');
  const [selectedRouteId, setSelectedRouteId] = useState('');
  const [laps, setLaps] = useState(1);
  
  // We now store selected sprints as full objects for better UI display later
  const [selectedSprints, setSelectedSprints] = useState<SelectedSegment[]>([]);
  const [segmentType, setSegmentType] = useState<'sprint' | 'split'>('sprint');
  
  // Settings Form State
  const [finishPointsStr, setFinishPointsStr] = useState('');
  const [sprintPointsStr, setSprintPointsStr] = useState('');
  const [bestRacesCount, setBestRacesCount] = useState(5);
  
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

  // Test Data Generator State
  const [testParticipantCount, setTestParticipantCount] = useState(0);
  const [participantsToGenerate, setParticipantsToGenerate] = useState(20);
  const [selectedTestRaces, setSelectedTestRaces] = useState<string[]>([]);
  const [testProgress, setTestProgress] = useState(100);
  const [testCategoryRiders, setTestCategoryRiders] = useState<Record<string, number>>({});

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
                    sprintPoints: settings.sprintPoints || [],
                    bestRacesCount: settings.bestRacesCount || 5
                });
                setFinishPointsStr((settings.finishPoints || []).join(', '));
                setSprintPointsStr((settings.sprintPoints || []).join(', '));
                setBestRacesCount(settings.bestRacesCount || 5);
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

  // Fetch test participant count on load
  useEffect(() => {
      if (user && !authLoading) {
          fetchTestParticipantCount();
      }
  }, [user, authLoading]);

  // Update category riders when selected races change
  useEffect(() => {
      initTestCategoryRiders();
  }, [selectedTestRaces, races]);

  // Fetch Segments when Route/Laps change
  useEffect(() => {
      if (!selectedRouteId) {
          setAvailableSegments([]);
          return;
      }
      
      const fetchSegments = async () => {
          try {
              // Determine MAX laps to fetch
              let maxLaps = laps;
              if (eventMode === 'multi' && eventConfiguration.length > 0) {
                  const cfgMax = Math.max(...eventConfiguration.map(c => c.laps || 0));
                  if (cfgMax > maxLaps) maxLaps = cfgMax;
              }
              // Also check single mode category configs
              if (eventMode === 'single' && singleModeCategories.length > 0) {
                  const catMax = Math.max(...singleModeCategories.map(c => c.laps || 0));
                  if (catMax > maxLaps) maxLaps = catMax;
              }

              const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
              const res = await fetch(`${apiUrl}/segments?routeId=${selectedRouteId}&laps=${maxLaps}`);
              if (res.ok) {
                  const data = await res.json();
                  setAvailableSegments(data.segments || []);
              }
          } catch (e) {
              console.error("Error fetching segments:", e);
          }
      };
      fetchSegments();
  }, [selectedRouteId, laps, eventMode, eventConfiguration.length, singleModeCategories.length]); // Relaxed dependency on configuration deep changes

  // Real-time listener for viewing results
  useEffect(() => {
      if (!viewingResultsId) return;

      const unsubscribe = onSnapshot(doc(db, 'races', viewingResultsId), (docSnapshot) => {
          if (docSnapshot.exists()) {
              const updatedData = docSnapshot.data();
              // Update local state for immediate feedback
              setRaces(prev => prev.map(r => r.id === viewingResultsId ? { ...r, ...updatedData } as Race : r));
          }
      }, (error) => {
          console.error("Error listening to race updates:", error);
      });

      return () => unsubscribe();
  }, [viewingResultsId]);

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
      setEventSecret(race.eventSecret || '');
      setEventMode(race.eventMode || 'single');
      setEventConfiguration(race.eventConfiguration || []);
      
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

      // Handle Per-Category Sprints Loading
      if (race.eventMode === 'multi' && race.eventConfiguration) {
        setEventConfiguration(race.eventConfiguration.map(c => ({
            ...c,
            sprints: c.sprints || [],
            segmentType: c.segmentType || 'sprint'
        })));
        setSingleModeCategories([]);
      } else {
        setEventConfiguration([]);
        // Load single mode category config
        if (race.singleModeCategories && race.singleModeCategories.length > 0) {
            setSingleModeCategories(race.singleModeCategories.map(c => ({
                ...c,
                sprints: c.sprints || [],
                segmentType: c.segmentType || 'sprint'
            })));
        } else {
            setSingleModeCategories([]);
        }
      }

      setSegmentType(race.segmentType || 'sprint');
      
      window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancel = () => {
      setEditingRaceId(null);
      setName('');
      setDate('');
      setEventId('');
      setEventSecret('');
      setEventMode('single');
      setEventConfiguration([]);
      setSingleModeCategories([]);
      setSelectedMap('');
      setSelectedRouteId('');
      setLaps(1);
      setSelectedSprints([]);
      setSegmentType('sprint');
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
              body: JSON.stringify({ finishPoints, sprintPoints, bestRacesCount })
          });
          
          if (res.ok) {
              alert('Settings saved!');
              setLeagueSettings({ finishPoints, sprintPoints, bestRacesCount });
          } else {
              alert('Failed to save settings');
          }
      } catch (e) {
          alert('Error saving settings');
      } finally {
          setStatus('idle');
      }
  };
  
  // Fetch test participant count
  const fetchTestParticipantCount = async () => {
      if (!user) return;
      try {
          const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
          const token = await user.getIdToken();
          const res = await fetch(`${apiUrl}/admin/seed/stats`, {
              headers: { 'Authorization': `Bearer ${token}` }
          });
          if (res.ok) {
              const data = await res.json();
              setTestParticipantCount(data.testParticipantCount || 0);
          }
      } catch (e) {
          console.error('Error fetching test stats:', e);
      }
  };

  // Generate test participants
  const handleGenerateParticipants = async (count: number = 20) => {
      if (!user) return;
      setStatus('seeding');
      try {
          const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
          const token = await user.getIdToken();
          const res = await fetch(`${apiUrl}/admin/seed/participants`, {
              method: 'POST',
              headers: { 
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json'
              },
              body: JSON.stringify({ count })
          });
          
          if (res.ok) {
              const data = await res.json();
              alert(data.message);
              fetchTestParticipantCount();
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

  // Clear test participants
  const handleClearParticipants = async () => {
      if (!user || !confirm('Delete all test participants?')) return;
      setStatus('seeding');
      try {
          const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
          const token = await user.getIdToken();
          const res = await fetch(`${apiUrl}/admin/seed/participants`, {
              method: 'DELETE',
              headers: { 'Authorization': `Bearer ${token}` }
          });
          
          if (res.ok) {
              const data = await res.json();
              alert(data.message);
              fetchTestParticipantCount();
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

  // Generate test results
  const handleGenerateResults = async () => {
      if (!user || selectedTestRaces.length === 0) {
          alert('Please select at least one race');
          return;
      }
      setStatus('seeding');
      try {
          const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
          const token = await user.getIdToken();
          const res = await fetch(`${apiUrl}/admin/seed/results`, {
              method: 'POST',
              headers: { 
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                  raceIds: selectedTestRaces,
                  progress: testProgress,
                  categoryRiders: testCategoryRiders
              })
          });
          
          if (res.ok) {
              const data = await res.json();
              alert(data.message);
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

  // Clear test results
  const handleClearResults = async (clearAll: boolean = false) => {
      const raceIds = clearAll ? [] : selectedTestRaces;
      const msg = clearAll 
          ? 'Clear results from ALL races?' 
          : `Clear results from ${selectedTestRaces.length} selected race(s)?`;
      
      if (!user || !confirm(msg)) return;
      
      setStatus('seeding');
      try {
          const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
          const token = await user.getIdToken();
          const res = await fetch(`${apiUrl}/admin/seed/results`, {
              method: 'DELETE',
              headers: { 
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json'
              },
              body: JSON.stringify({ raceIds })
          });
          
          if (res.ok) {
              const data = await res.json();
              alert(data.message);
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

  // Get categories for selected races
  const getTestCategories = (): string[] => {
      if (selectedTestRaces.length === 0) return ['A', 'B', 'C', 'D', 'E'];
      
      const allCategories = new Set<string>();
      
      for (const raceId of selectedTestRaces) {
          const race = races.find(r => r.id === raceId);
          if (!race) continue;
          
          if (race.eventMode === 'multi' && race.eventConfiguration) {
              race.eventConfiguration.forEach(cfg => {
                  if (cfg.customCategory) allCategories.add(cfg.customCategory);
              });
          } else if (race.singleModeCategories && race.singleModeCategories.length > 0) {
              race.singleModeCategories.forEach(cfg => {
                  if (cfg.category) allCategories.add(cfg.category);
              });
          } else {
              ['A', 'B', 'C', 'D', 'E'].forEach(c => allCategories.add(c));
          }
      }
      
      return Array.from(allCategories).sort();
  };

  // Initialize category riders when races change
  const initTestCategoryRiders = () => {
      const cats = getTestCategories();
      const newRiders: Record<string, number> = {};
      cats.forEach(cat => {
          newRiders[cat] = testCategoryRiders[cat] ?? 5;
      });
      setTestCategoryRiders(newRiders);
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

        const raceData: any = {
            name,
            date,
            routeId: selectedRoute.id,
            routeName: selectedRoute.name,
            map: selectedRoute.map,
            laps,
            totalDistance: Number(calcDistance),
            totalElevation: Number(calcElevation),
            selectedSegments: selectedSprints.map(s => s.key), // Keep for legacy/compat
            sprints: selectedSprints, // Save full objects
            segmentType,
            eventMode
        };

        if (eventMode === 'single') {
            raceData.eventId = eventId;
            raceData.eventSecret = eventSecret;
            raceData.eventConfiguration = [];
            raceData.singleModeCategories = singleModeCategories.length > 0 ? singleModeCategories : [];
            // Searchable Index
            raceData.linkedEventIds = eventId ? [eventId] : [];
        } else {
            raceData.eventConfiguration = eventConfiguration;
            raceData.singleModeCategories = [];
            raceData.eventId = ''; 
            raceData.eventSecret = '';
            // Searchable Index
            raceData.linkedEventIds = eventConfiguration.map(c => c.eventId).filter(Boolean);
        }
        
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

  const addEventConfig = () => {
      setEventConfiguration([...eventConfiguration, { eventId: '', eventSecret: '', customCategory: '', laps: laps, startTime: '', sprints: [], segmentType: 'sprint' }]);
  };

  const removeEventConfig = (index: number) => {
      const newConfig = [...eventConfiguration];
      newConfig.splice(index, 1);
      setEventConfiguration(newConfig);
  };

  const updateEventConfig = (index: number, field: keyof typeof eventConfiguration[0], value: any) => {
      const newConfig = [...eventConfiguration];
      newConfig[index] = { ...newConfig[index], [field]: value };
      setEventConfiguration(newConfig);
  };

  // Helper to toggle a sprint for a specific configuration
  const toggleConfigSprint = (configIndex: number, seg: Segment) => {
    const config = eventConfiguration[configIndex];
    const currentSprints = config.sprints || [];
    const key = `${seg.id}_${seg.count}`;
    
    let newSprints;
    if (currentSprints.some(s => s.key === key)) {
        newSprints = currentSprints.filter(s => s.key !== key);
    } else {
        newSprints = [...currentSprints, { ...seg, key }];
    }
    
    updateEventConfig(configIndex, 'sprints', newSprints);
  };

  // Single Mode Category Helpers
  const addSingleModeCategory = () => {
      const defaultCategories = ['A', 'B', 'C', 'D', 'E'];
      const usedCategories = singleModeCategories.map(c => c.category);
      const nextCategory = defaultCategories.find(c => !usedCategories.includes(c)) || '';
      setSingleModeCategories([...singleModeCategories, { 
          category: nextCategory, 
          laps: laps, 
          sprints: [], 
          segmentType: 'sprint' 
      }]);
  };

  const removeSingleModeCategory = (index: number) => {
      const newConfig = [...singleModeCategories];
      newConfig.splice(index, 1);
      setSingleModeCategories(newConfig);
  };

  const updateSingleModeCategory = (index: number, field: keyof CategoryConfig, value: any) => {
      const newConfig = [...singleModeCategories];
      newConfig[index] = { ...newConfig[index], [field]: value };
      setSingleModeCategories(newConfig);
  };

  const toggleSingleModeCategorySprint = (configIndex: number, seg: Segment) => {
      const config = singleModeCategories[configIndex];
      const currentSprints = config.sprints || [];
      const key = `${seg.id}_${seg.count}`;
      
      let newSprints;
      if (currentSprints.some(s => s.key === key)) {
          newSprints = currentSprints.filter(s => s.key !== key);
      } else {
          newSprints = [...currentSprints, { ...seg, key }];
      }
      
      updateSingleModeCategory(configIndex, 'sprints', newSprints);
  };

  const handleToggleDQ = async (raceId: string, zwiftId: string, isCurrentlyDQ: boolean) => {
      try {
          const raceRef = doc(db, 'races', raceId);
          if (isCurrentlyDQ) {
              await updateDoc(raceRef, {
                  manualDQs: arrayRemove(zwiftId)
              });
          } else {
              await updateDoc(raceRef, {
                  manualDQs: arrayUnion(zwiftId),
                  manualDeclassifications: arrayRemove(zwiftId) // Remove from declass if adding to DQ
              });
          }
      } catch (e) {
          console.error("Error updating DQ status:", e);
          alert("Failed to update DQ status");
      }
  };

  const handleToggleDeclass = async (raceId: string, zwiftId: string, isCurrentlyDeclass: boolean) => {
      try {
          const raceRef = doc(db, 'races', raceId);
          if (isCurrentlyDeclass) {
              await updateDoc(raceRef, {
                  manualDeclassifications: arrayRemove(zwiftId)
              });
          } else {
              await updateDoc(raceRef, {
                  manualDeclassifications: arrayUnion(zwiftId),
                  manualDQs: arrayRemove(zwiftId) // Remove from DQ if adding to Declass
              });
          }
      } catch (e) {
          console.error("Error updating Declass status:", e);
          alert("Failed to update Declass status");
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
          <button 
            onClick={() => setActiveTab('testing')}
            className={`pb-2 px-4 font-medium transition ${activeTab === 'testing' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
          >
              Testing
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
                        <div>
                            <label className="block font-medium text-card-foreground mb-2">Number of Counting Races</label>
                            <p className="text-xs text-muted-foreground mb-2">How many best results count towards the final league standing.</p>
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

      {activeTab === 'testing' && (
          <div className="max-w-4xl">
              <div className="bg-card p-6 rounded-lg shadow border border-border mb-8">
                  <h2 className="text-xl font-semibold mb-2 text-card-foreground">Test Data Generator</h2>
                  <p className="text-sm text-muted-foreground mb-6">
                      Generate fake participants and results to test live pages, results displays, and league standings without real race data.
                  </p>
                  
                  {/* Test Participants Section */}
                  <div className="mb-8 pb-8 border-b border-border">
                      <h3 className="text-lg font-semibold text-card-foreground mb-4">Test Participants</h3>
                      <p className="text-sm text-muted-foreground mb-4">
                          Currently: <span className="font-bold text-foreground text-lg">{testParticipantCount}</span> test participants in database
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
                                  {status === 'seeding' ? 'Working...' : 'Generate Participants'}
                              </button>
                          </div>
                          <button
                              type="button"
                              onClick={handleClearParticipants}
                              disabled={status === 'seeding' || testParticipantCount === 0}
                              className="bg-destructive text-destructive-foreground px-4 py-2 rounded hover:opacity-90 font-medium disabled:opacity-50"
                          >
                              Clear All Participants
                          </button>
                      </div>
                  </div>

                  {/* Test Results Section */}
                  <div>
                      <h3 className="text-lg font-semibold text-card-foreground mb-4">Test Results</h3>
                      
                      {/* Race Selection */}
                      <div className="mb-6">
                          <label className="block text-sm font-medium text-card-foreground mb-2">Select Races to Generate Results For</label>
                          <div className="max-h-48 overflow-y-auto border border-input rounded-lg bg-background p-3 space-y-2">
                              {races.map(race => (
                                  <label key={race.id} className="flex items-center gap-3 cursor-pointer hover:bg-muted/50 p-2 rounded-md transition">
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
                                      <span className="text-xs text-muted-foreground ml-auto">
                                          {new Date(race.date).toLocaleDateString()}
                                      </span>
                                  </label>
                              ))}
                              {races.length === 0 && (
                                  <p className="text-sm text-muted-foreground italic p-4 text-center">No races configured. Create races in the Races tab first.</p>
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

                      {/* Riders per Category */}
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
                                                  [cat]: parseInt(e.target.value) || 0
                                              })}
                                              className="w-full p-2 border border-input rounded bg-background text-foreground text-sm text-center"
                                          />
                                      </div>
                                  ))}
                              </div>
                              <p className="text-sm text-muted-foreground mt-3">
                                  Total: <span className="font-bold text-foreground">{Object.values(testCategoryRiders).reduce((a, b) => a + b, 0)}</span> riders per race
                              </p>
                          </div>
                      )}

                      {/* Progress Slider */}
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
                                  {testProgress === 0 && "📋 Empty results - riders listed with no times or points"}
                                  {testProgress > 0 && testProgress < 50 && "🏃 Early race - some sprints completed, no finishers yet"}
                                  {testProgress >= 50 && testProgress < 100 && `🚴 Mid-race - ~${testProgress}% of riders finished, sprints in progress`}
                                  {testProgress === 100 && "🏁 Complete race - all riders finished, all sprints and points calculated"}
                              </p>
                          </div>
                      )}

                      {/* Action Buttons */}
                      <div className="flex gap-3 flex-wrap pt-4 border-t border-border">
                          <button
                              type="button"
                              onClick={handleGenerateResults}
                              disabled={status === 'seeding' || selectedTestRaces.length === 0}
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
                              Clear Selected Results
                          </button>
                          <button
                              type="button"
                              onClick={() => handleClearResults(true)}
                              disabled={status === 'seeding'}
                              className="bg-destructive text-destructive-foreground px-5 py-2.5 rounded hover:opacity-90 font-medium disabled:opacity-50"
                          >
                              Clear All Race Results
                          </button>
                      </div>
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
                              <label className="block text-sm font-medium text-muted-foreground mb-2">Result Source Configuration</label>
                              
                              <div className="flex gap-4 mb-4">
                                  <label className="flex items-center gap-2 cursor-pointer">
                                      <input 
                                        type="radio" 
                                        name="eventMode"
                                        checked={eventMode === 'single'}
                                        onChange={() => setEventMode('single')}
                                        className="text-primary focus:ring-primary"
                                      />
                                      <span className="text-sm">Standard (Single Zwift Event)</span>
                                  </label>
                                  <label className="flex items-center gap-2 cursor-pointer">
                                      <input 
                                        type="radio" 
                                        name="eventMode"
                                        checked={eventMode === 'multi'}
                                        onChange={() => setEventMode('multi')}
                                        className="text-primary focus:ring-primary"
                                      />
                                      <span className="text-sm">Multi-Category (Multiple IDs)</span>
                                  </label>
                              </div>

                              {eventMode === 'single' ? (
                                  <div className="space-y-4">
                                      <div className="grid grid-cols-2 gap-4">
                                          <div>
                                              <label className="block text-xs font-medium text-muted-foreground mb-1">Zwift Event ID</label>
                                              <input 
                                                type="text" 
                                                value={eventId}
                                                onChange={e => setEventId(e.target.value)}
                                                className="w-full p-2 border border-input rounded bg-background text-foreground"
                                                placeholder="e.g. 123456"
                                              />
                                          </div>
                                          <div>
                                              <label className="block text-xs font-medium text-muted-foreground mb-1">Event Secret (Optional)</label>
                                              <input 
                                                type="text" 
                                                value={eventSecret}
                                                onChange={e => setEventSecret(e.target.value)}
                                                className="w-full p-2 border border-input rounded bg-background text-foreground"
                                                placeholder="e.g. abc123xyz"
                                              />
                                          </div>
                                      </div>

                                      {/* Per-Category Configuration for Single Mode */}
                                      <div className="border-t border-border pt-4">
                                          <div className="flex justify-between items-center mb-3">
                                              <div>
                                                  <label className="block text-sm font-medium text-foreground">Category Configuration</label>
                                                  <p className="text-xs text-muted-foreground">
                                                      {singleModeCategories.length === 0 
                                                          ? "Default: Uses Zwift categories (A, B, C, D, E) with global laps/sprints" 
                                                          : "Custom: Per-category laps and sprint configuration"}
                                                  </p>
                                              </div>
                                              <button
                                                  type="button"
                                                  onClick={addSingleModeCategory}
                                                  className="text-sm text-primary hover:text-primary/80 font-medium"
                                              >
                                                  + Add Category
                                              </button>
                                          </div>

                                          {singleModeCategories.length > 0 && (
                                              <div className="space-y-3">
                                                  {singleModeCategories.map((config, idx) => (
                                                      <div key={idx} className="flex flex-col gap-2 p-3 bg-muted/20 rounded border border-border">
                                                          <div className="flex gap-2 items-start">
                                                              <div className="w-24">
                                                                  <label className="text-[10px] text-muted-foreground font-bold uppercase block mb-1">Category</label>
                                                                  <input 
                                                                    type="text" 
                                                                    value={config.category}
                                                                    onChange={e => updateSingleModeCategory(idx, 'category', e.target.value)}
                                                                    className="w-full p-2 border border-input rounded bg-background text-foreground text-sm"
                                                                    placeholder="e.g. A"
                                                                  />
                                                              </div>
                                                              <div className="w-20">
                                                                  <label className="text-[10px] text-muted-foreground font-bold uppercase block mb-1">Laps</label>
                                                                  <input 
                                                                    type="number" 
                                                                    value={config.laps || laps}
                                                                    onChange={e => updateSingleModeCategory(idx, 'laps', parseInt(e.target.value))}
                                                                    className="w-full p-2 border border-input rounded bg-background text-foreground text-sm"
                                                                    min="1"
                                                                  />
                                                              </div>
                                                              <div className="flex-1">
                                                                  <label className="text-[10px] text-muted-foreground font-bold uppercase block mb-1">Segments Used For</label>
                                                                  <select
                                                                    value={config.segmentType || 'sprint'}
                                                                    onChange={e => updateSingleModeCategory(idx, 'segmentType', e.target.value as 'sprint' | 'split')}
                                                                    className="w-full p-2 border border-input rounded bg-background text-foreground text-sm"
                                                                  >
                                                                      <option value="sprint">Sprint Points</option>
                                                                      <option value="split">Time Trial Splits</option>
                                                                  </select>
                                                              </div>
                                                              <button 
                                                                type="button" 
                                                                onClick={() => removeSingleModeCategory(idx)}
                                                                className="text-red-500 hover:text-red-700 px-2 pt-6"
                                                              >
                                                                  ✕
                                                              </button>
                                                          </div>
                                                          
                                                          {/* Per-Category Sprint Selection */}
                                                          <div className="mt-2">
                                                              <details className="group border border-input rounded bg-background">
                                                                  <summary className="list-none flex justify-between items-center p-2 cursor-pointer text-xs font-medium text-foreground select-none">
                                                                      <span>
                                                                          {config.segmentType === 'split' ? 'Split Segments' : 'Sprint Segments'} ({config.sprints?.length || 0} selected)
                                                                      </span>
                                                                      <span className="text-muted-foreground group-open:rotate-180 transition-transform">
                                                                          ▼
                                                                      </span>
                                                                  </summary>
                                                                  
                                                                  <div className="p-2 border-t border-input max-h-60 overflow-y-auto bg-muted/10">
                                                                       {Object.keys(segmentsByLap).sort((a,b) => parseInt(a)-parseInt(b)).map(lapKey => {
                                                                          const lapNum = parseInt(lapKey);
                                                                          // Only show segments up to the laps configured for this category
                                                                          if (lapNum > (config.laps || laps)) return null;
                                                                          
                                                                          return (
                                                                              <div key={lapNum} className="mb-2">
                                                                                  <div className="text-[10px] font-bold text-muted-foreground uppercase mb-1 bg-muted/30 px-1 rounded">Lap {lapNum}</div>
                                                                                          {segmentsByLap[lapNum].map(seg => {
                                                                                              const uniqueKey = `${seg.id}_${seg.count}`;
                                                                                              const isSelected = config.sprints?.some(s => s.key === uniqueKey);
                                                                                      return (
                                                                                          <label key={uniqueKey} className="flex items-center gap-2 p-1.5 hover:bg-muted/50 rounded cursor-pointer">
                                                                                              <input 
                                                                                                  type="checkbox"
                                                                                                  checked={isSelected}
                                                                                                  onChange={() => toggleSingleModeCategorySprint(idx, seg)}
                                                                                                  className="w-3 h-3 rounded border-input text-primary focus:ring-primary"
                                                                                              />
                                                                                              <div className="text-xs truncate" title={`${seg.name} (${seg.direction})`}>
                                                                                                  {seg.name}
                                                                                              </div>
                                                                                          </label>
                                                                                      );
                                                                                  })}
                                                                              </div>
                                                                          );
                                                                      })}
                                                                      {availableSegments.length === 0 && (
                                                                          <div className="text-xs text-muted-foreground p-2 text-center italic">No segments found. Select Route first.</div>
                                                                      )}
                                                                  </div>
                                                              </details>
                                                          </div>
                                                      </div>
                                                  ))}
                                              </div>
                                          )}
                                      </div>
                                  </div>
                              ) : (
                                  <div className="space-y-3">
                                      {eventConfiguration.map((config, idx) => (
                                          <div key={idx} className="flex flex-col gap-2 p-3 bg-muted/20 rounded border border-border">
                                              <div className="flex gap-2 items-start">
                                                  <div className="flex-1">
                                                      <label className="text-[10px] text-muted-foreground font-bold uppercase block mb-1">Zwift ID</label>
                                                      <input 
                                                        type="text" 
                                                        value={config.eventId}
                                                        onChange={e => updateEventConfig(idx, 'eventId', e.target.value)}
                                                        className="w-full p-2 border border-input rounded bg-background text-foreground text-sm"
                                                        placeholder="e.g. 12345"
                                                      />
                                                  </div>
                                                  <div className="flex-1">
                                                       <label className="text-[10px] text-muted-foreground font-bold uppercase block mb-1">Category Name</label>
                                                      <input 
                                                        type="text" 
                                                        value={config.customCategory}
                                                        onChange={e => updateEventConfig(idx, 'customCategory', e.target.value)}
                                                        className="w-full p-2 border border-input rounded bg-background text-foreground text-sm"
                                                        placeholder="e.g. Elite Men"
                                                      />
                                                  </div>
                                                  <button 
                                                    type="button" 
                                                    onClick={() => removeEventConfig(idx)}
                                                    className="text-red-500 hover:text-red-700 px-2 pt-6"
                                                  >
                                                      ✕
                                                  </button>
                                              </div>
                                              <div className="flex gap-2 items-start">
                                                   <div className="flex-1">
                                                      <label className="text-[10px] text-muted-foreground font-bold uppercase block mb-1">Secret (Opt)</label>
                                                      <input 
                                                        type="text" 
                                                        value={config.eventSecret}
                                                        onChange={e => updateEventConfig(idx, 'eventSecret', e.target.value)}
                                                        className="w-full p-2 border border-input rounded bg-background text-foreground text-sm"
                                                        placeholder="Secret"
                                                      />
                                                  </div>
                                                  <div className="w-20">
                                                      <label className="text-[10px] text-muted-foreground font-bold uppercase block mb-1">Laps</label>
                                                      <input 
                                                        type="number" 
                                                        value={config.laps || laps}
                                                        onChange={e => updateEventConfig(idx, 'laps', parseInt(e.target.value))}
                                                        className="w-full p-2 border border-input rounded bg-background text-foreground text-sm"
                                                        min="1"
                                                      />
                                                  </div>
                                                  <div className="flex-1">
                                                      <label className="text-[10px] text-muted-foreground font-bold uppercase block mb-1">Start Time (Opt)</label>
                                                      <input 
                                                        type="time" 
                                                        value={config.startTime || ''}
                                                        onChange={e => updateEventConfig(idx, 'startTime', e.target.value)}
                                                        className="w-full p-2 border border-input rounded bg-background text-foreground text-sm"
                                                      />
                                                  </div>
                                                  <div className="w-32">
                                                      <label className="text-[10px] text-muted-foreground font-bold uppercase block mb-1">Segments Used For</label>
                                                      <select
                                                        value={config.segmentType || 'sprint'}
                                                        onChange={e => updateEventConfig(idx, 'segmentType', e.target.value as 'sprint' | 'split')}
                                                        className="w-full p-2 border border-input rounded bg-background text-foreground text-sm"
                                                      >
                                                          <option value="sprint">Sprint Points</option>
                                                          <option value="split">Time Trial Splits</option>
                                                      </select>
                                                  </div>
                                              </div>
                                              
                                              {/* Per-Category Sprint Selection Accordion */}
                                              <div className="mt-2">
                                                  <details className="group border border-input rounded bg-background">
                                                      <summary className="list-none flex justify-between items-center p-2 cursor-pointer text-xs font-medium text-foreground select-none">
                                                          <span>
                                                              {config.segmentType === 'split' ? 'Split Segments' : 'Sprint Segments'} ({config.sprints?.length || 0} selected)
                                                          </span>
                                                          <span className="text-muted-foreground group-open:rotate-180 transition-transform">
                                                              ▼
                                                          </span>
                                                      </summary>
                                                      
                                                      <div className="p-2 border-t border-input max-h-60 overflow-y-auto bg-muted/10">
                                                           {Object.keys(segmentsByLap).sort((a,b) => parseInt(a)-parseInt(b)).map(lapKey => {
                                                              const lapNum = parseInt(lapKey);
                                                              // Only show segments up to the laps configured for this category
                                                              if (lapNum > (config.laps || laps)) return null;
                                                              
                                                              return (
                                                                  <div key={lapNum} className="mb-2">
                                                                      <div className="text-[10px] font-bold text-muted-foreground uppercase mb-1 bg-muted/30 px-1 rounded">Lap {lapNum}</div>
                                                                              {segmentsByLap[lapNum].map(seg => {
                                                                                  const uniqueKey = `${seg.id}_${seg.count}`;
                                                                                  const isSelected = config.sprints?.some(s => s.key === uniqueKey);
                                                                          return (
                                                                              <label key={uniqueKey} className="flex items-center gap-2 p-1.5 hover:bg-muted/50 rounded cursor-pointer">
                                                                                  <input 
                                                                                      type="checkbox"
                                                                                      checked={isSelected}
                                                                                      onChange={() => toggleConfigSprint(idx, seg)}
                                                                                      className="w-3 h-3 rounded border-input text-primary focus:ring-primary"
                                                                                  />
                                                                                  <div className="text-xs truncate" title={`${seg.name} (${seg.direction})`}>
                                                                                      {seg.name}
                                                                                  </div>
                                                                              </label>
                                                                          );
                                                                      })}
                                                                  </div>
                                                              );
                                                          })}
                                                          {availableSegments.length === 0 && (
                                                              <div className="text-xs text-muted-foreground p-2 text-center italic">No segments found. Select Route first.</div>
                                                          )}
                                                      </div>
                                                  </details>
                                              </div>
                                          </div>
                                      ))}
                                      <button 
                                        type="button"
                                        onClick={addEventConfig}
                                        className="text-sm text-primary hover:text-primary/80 font-medium"
                                      >
                                          + Add Category Source
                                      </button>
                                  </div>
                              )}
                              <p className="text-xs text-muted-foreground mt-2">
                                  {eventMode === 'single' 
                                    ? "Used to fetch race results automatically from a single event." 
                                    : "Map multiple Zwift Events to specific categories (e.g. Event 101 -> Elite Men, Event 102 -> H40)."}
                              </p>
                          </div>

                          {/* Global Sprint Selection (Single Mode Only, when no per-category config) */}
                          {eventMode === 'single' && singleModeCategories.length === 0 && (
                            <div className="border-t border-border pt-4">
                                <div className="mb-3">
                                    <label className="block font-medium text-card-foreground mb-1">Segments Used For</label>
                                    <select
                                        value={segmentType}
                                        onChange={(e) => setSegmentType(e.target.value as 'sprint' | 'split')}
                                        className="w-full sm:w-64 p-2 border border-input rounded bg-background text-foreground text-sm"
                                    >
                                        <option value="sprint">Sprint Points</option>
                                        <option value="split">Time Trial Splits</option>
                                    </select>
                                </div>
                                <label className="block font-medium text-card-foreground mb-3">
                                    {segmentType === 'split' ? 'Split Segments' : 'Sprint Segments (Scoring)'}
                                </label>
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
                          )}
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

          {/* Results Modal */}
          {viewingResultsId && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                  <div className="bg-card w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-lg shadow-2xl border border-border flex flex-col">
                      <div className="p-4 border-b border-border flex justify-between items-center bg-muted/30">
                          <div className="flex items-center gap-4">
                              <h3 className="text-lg font-bold text-card-foreground">
                                  Results: {races.find(r => r.id === viewingResultsId)?.name}
                              </h3>
                              <button 
                                  onClick={() => handleRefreshResults(viewingResultsId!)}
                                  disabled={status === 'refreshing'}
                                  className="text-xs bg-primary text-primary-foreground px-3 py-1 rounded hover:opacity-90 font-medium"
                              >
                                  {status === 'refreshing' ? 'Calculating...' : 'Recalculate Results'}
                              </button>
                          </div>
                          <button 
                              onClick={() => setViewingResultsId(null)}
                              className="text-muted-foreground hover:text-foreground p-1"
                          >
                              ✕
                          </button>
                      </div>
                      <div className="overflow-y-auto p-4 space-y-6">
                          {(() => {
                              const race = races.find(r => r.id === viewingResultsId);
                              const results = race?.results || {};
                              
                              // Sort categories: Custom Order if Multi-Event, else Alphabetical
                              let categories = Object.keys(results);
                              
                              if (race?.eventMode === 'multi' && race.eventConfiguration) {
                                  // Create a map of category -> index
                                  const orderMap = new Map();
                                  race.eventConfiguration.forEach((cfg, idx) => {
                                      if (cfg.customCategory) orderMap.set(cfg.customCategory, idx);
                                  });
                                  
                                  categories.sort((a, b) => {
                                      const idxA = orderMap.has(a) ? orderMap.get(a) : 999;
                                      const idxB = orderMap.has(b) ? orderMap.get(b) : 999;
                                      return idxA - idxB;
                                  });
                              } else {
                                  categories.sort();
                              }
                              
                              if (categories.length === 0) {
                                  return <div className="text-center text-muted-foreground p-8">No results calculated yet.</div>;
                              }

                              return categories.map(cat => (
                                  <div key={cat} className="border border-border rounded-lg overflow-hidden">
                                      <div className="bg-secondary/50 px-4 py-2 font-semibold text-sm border-b border-border">
                                          {cat}
                                      </div>
                                      <table className="w-full text-left text-sm">
                                          <thead className="bg-muted/20 text-xs text-muted-foreground">
                                              <tr>
                                                  <th className="px-4 py-2 w-12">Pos</th>
                                                  <th className="px-4 py-2">Rider</th>
                                                  <th className="px-4 py-2 text-right">Time</th>
                                                  <th className="px-4 py-2 text-right">Pts</th>
                                                  <th className="px-4 py-2 text-center w-20">Flags</th>
                                                  <th className="px-4 py-2 text-center w-12" title="Disqualify (0 pts)">DQ</th>
                                                  <th className="px-4 py-2 text-center w-12" title="Declassify (Last place pts)">DC</th>
                                              </tr>
                                          </thead>
                                          <tbody className="divide-y divide-border">
                                              {results[cat].map((rider: any, idx: number) => {
                                                  const isFlagged = rider.flaggedCheating || rider.flaggedSandbagging;
                                                  const isManualDQ = (race?.manualDQs || []).includes(rider.zwiftId);
                                                  const isManualDeclass = (race?.manualDeclassifications || []).includes(rider.zwiftId);
                                                  
                                                  return (
                                                      <tr key={rider.zwiftId} className={`hover:bg-muted/10 ${isFlagged || isManualDQ ? 'bg-red-50 dark:bg-red-950/20' : isManualDeclass ? 'bg-yellow-50 dark:bg-yellow-950/20' : ''}`}>
                                                          <td className="px-4 py-2 text-muted-foreground">{isManualDQ ? '-' : isManualDeclass ? '*' : idx + 1}</td>
                                                          <td className="px-4 py-2 font-medium">
                                                              {rider.name}
                                                              {isFlagged && (
                                                                  <div className="text-[10px] text-red-600 font-bold mt-0.5">
                                                                      {rider.flaggedCheating ? 'CHEATING ' : ''}
                                                                      {rider.flaggedSandbagging ? 'SANDBAGGING' : ''}
                                                                  </div>
                                                              )}
                                                              {isManualDQ && (
                                                                  <div className="text-[10px] text-red-600 font-bold mt-0.5">
                                                                      DISQUALIFIED
                                                                  </div>
                                                              )}
                                                              {isManualDeclass && (
                                                                  <div className="text-[10px] text-yellow-600 font-bold mt-0.5">
                                                                      DECLASSIFIED
                                                                  </div>
                                                              )}
                                                          </td>
                                                          <td className="px-4 py-2 text-right font-mono text-muted-foreground">
                                                              {rider.finishTime > 0 ? new Date(rider.finishTime).toISOString().substr(11, 8) : '-'}
                                                          </td>
                                                          <td className="px-4 py-2 text-right font-bold text-primary">
                                                              {rider.totalPoints}
                                                              {(isManualDQ && rider.totalPoints > 0) || (isManualDeclass && rider.totalPoints === 0) ? (
                                                                  <span className="text-[10px] text-red-500 block" title="Recalculation needed">
                                                                      (Recalc)
                                                                  </span>
                                                              ) : null}
                                                          </td>
                                                          <td className="px-4 py-2 text-center">
                                                              {isFlagged && <span className="text-xl" title="Flagged">🚩</span>}
                                                          </td>
                                                          <td className="px-4 py-2 text-center">
                                                              <input 
                                                                  type="checkbox"
                                                                  checked={isManualDQ}
                                                                  onChange={() => race && handleToggleDQ(race.id, rider.zwiftId, isManualDQ)}
                                                                  disabled={isManualDeclass}
                                                                  title={isManualDeclass ? "Uncheck Declassify first" : "Disqualify"}
                                                                  className="w-4 h-4 rounded border-input text-primary focus:ring-primary cursor-pointer disabled:opacity-30"
                                                              />
                                                          </td>
                                                          <td className="px-4 py-2 text-center">
                                                              <input 
                                                                  type="checkbox"
                                                                  checked={isManualDeclass}
                                                                  onChange={() => race && handleToggleDeclass(race.id, rider.zwiftId, isManualDeclass)}
                                                                  disabled={isManualDQ}
                                                                  title={isManualDQ ? "Uncheck DQ first" : "Declassify"}
                                                                  className="w-4 h-4 rounded border-input text-yellow-500 focus:ring-yellow-500 cursor-pointer disabled:opacity-30"
                                                              />
                                                          </td>
                                                      </tr>
                                                  );
                                              })}
                                          </tbody>
                                      </table>
                                  </div>
                              ));
                          })()}
                      </div>
                  </div>
              </div>
          )}

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
                            <th className="px-6 py-3 text-right">Results</th>
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
                                    {r.eventMode === 'multi' ? (
                                        <div className="text-xs text-primary/70">
                                            {r.eventConfiguration?.length} Linked Events
                                        </div>
                                    ) : (
                                        r.eventId && <div className="text-xs text-primary/70">Event ID: {r.eventId}</div>
                                    )}
                                </td>
                                <td className="px-6 py-4 text-muted-foreground">
                                    {r.sprints ? r.sprints.length : (r.selectedSegments ? r.selectedSegments.length : 0)} selected
                                </td>
                                <td className="px-6 py-4 text-right space-x-2 whitespace-nowrap">
                                    {(r.eventId || (r.eventConfiguration && r.eventConfiguration.length > 0)) && (
                                        <>
                                            <button 
                                                onClick={() => handleRefreshResults(r.id)}
                                                disabled={status === 'refreshing'}
                                                className="text-green-600 hover:text-green-700 dark:text-green-400 font-medium px-2 py-1"
                                            >
                                                Calc
                                            </button>
                                            <button 
                                                onClick={() => setViewingResultsId(r.id)}
                                                className="text-blue-600 hover:text-blue-700 dark:text-blue-400 font-medium px-2 py-1"
                                            >
                                                View
                                            </button>
                                        </>
                                    )}
                                </td>
                                <td className="px-6 py-4 text-right space-x-2 whitespace-nowrap">
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
                                <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">No races scheduled.</td>
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

