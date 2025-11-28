'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';

interface Segment {
  id: string;
  name: string;
  count: number;
  direction: string;
  lap: number;
  key?: string;
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
  sprints?: Segment[];
}

const getZwiftInsiderUrl = (routeName: string) => {
    if (!routeName) return '#';
    const slug = routeName.toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\w\-]+/g, '')
        .replace(/\-\-+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '');
    return `https://zwiftinsider.com/route/${slug}/`;
};

export default function SchedulePage() {
  const { user, loading: authLoading, isRegistered } = useAuth();
  const router = useRouter();
  const [races, setRaces] = useState<Race[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading) {
        if (!user) {
            router.push('/');
        } else if (!isRegistered) {
            router.push('/register');
        }
    }
  }, [user, authLoading, isRegistered, router]);

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
                // Sort by date ascending
                const sorted = (data.races || []).sort((a: Race, b: Race) => 
                    new Date(a.date).getTime() - new Date(b.date).getTime()
                );
                setRaces(sorted);
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

  if (authLoading || loading) {
      return <div className="p-8 text-center text-muted-foreground">Loading schedule...</div>;
  }

  if (!isRegistered) return null;

  const futureRaces = races.filter(r => new Date(r.date) > new Date());
  const pastRaces = races.filter(r => new Date(r.date) <= new Date()).reverse();

  const RaceCard = ({ race, isPast = false }: { race: Race, isPast?: boolean }) => {
      const raceDate = new Date(race.date);
      
      // Group sprints by lap for display
      const sprintsByLap = (race.sprints || []).reduce((acc, seg) => {
          const lap = seg.lap || 1;
          if (!acc[lap]) acc[lap] = [];
          acc[lap].push(seg);
          return acc;
      }, {} as Record<number, Segment[]>);

      return (
          <div className={`bg-card border border-border rounded-lg shadow-sm overflow-hidden mb-6 ${isPast ? 'opacity-75' : ''}`}>
              <div className="p-6">
                  <div className="flex flex-col md:flex-row justify-between md:items-start gap-4 mb-4">
                      <div>
                          <div className="text-sm font-medium text-primary mb-1">
                              {raceDate.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                          </div>
                          <h3 className="text-2xl font-bold text-card-foreground">{race.name}</h3>
                          <div className="text-muted-foreground text-sm mt-1">
                             Start: {raceDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                          </div>
                      </div>
                      <div className="bg-muted/30 px-4 py-2 rounded-lg text-right">
                          <div className="font-semibold text-card-foreground">{race.map}</div>
                          <div className="text-sm text-muted-foreground flex items-center justify-end gap-1">
                              {race.routeName}
                              <a 
                                href={getZwiftInsiderUrl(race.routeName)} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-xs text-primary hover:underline"
                                title="View on ZwiftInsider"
                              >
                                  (Info ↗)
                              </a>
                          </div>
                      </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 mb-6 text-sm">
                      <div className="bg-muted/20 p-3 rounded text-center">
                          <div className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Distance</div>
                          <div className="font-semibold text-card-foreground">{race.totalDistance} km</div>
                      </div>
                      <div className="bg-muted/20 p-3 rounded text-center">
                          <div className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Elevation</div>
                          <div className="font-semibold text-card-foreground">{race.totalElevation} m</div>
                      </div>
                      <div className="bg-muted/20 p-3 rounded text-center">
                          <div className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Laps</div>
                          <div className="font-semibold text-card-foreground">{race.laps}</div>
                      </div>
                  </div>

                  {(race.sprints && race.sprints.length > 0) && (
                      <div className="border-t border-border pt-4">
                          <h4 className="text-sm font-semibold text-card-foreground mb-3">Points Sprints</h4>
                          <div className="space-y-3">
                              {Object.keys(sprintsByLap).sort((a,b) => parseInt(a)-parseInt(b)).map(lapKey => {
                                  const lapNum = parseInt(lapKey);
                                  return (
                                      <div key={lapNum} className="flex flex-col sm:flex-row gap-2 sm:gap-8 text-sm">
                                          <div className="w-16 font-medium text-muted-foreground shrink-0">Lap {lapNum}</div>
                                          <div className="flex-1 flex flex-wrap gap-2">
                                              {sprintsByLap[lapNum].sort((a,b) => a.count - b.count).map((seg, idx) => (
                                                  <span key={idx} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                                                      {seg.name}
                                                  </span>
                                              ))}
                                          </div>
                                      </div>
                                  );
                              })}
                          </div>
                      </div>
                  )}
              </div>
          </div>
      );
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8 text-foreground">League Schedule</h1>
      
      {futureRaces.length > 0 && (
          <div className="mb-12">
              <h2 className="text-xl font-semibold mb-6 text-muted-foreground flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500"></span>
                  Upcoming Races
              </h2>
              {futureRaces.map(race => (
                  <RaceCard key={race.id} race={race} />
              ))}
          </div>
      )}

      {pastRaces.length > 0 && (
          <div>
              <h2 className="text-xl font-semibold mb-6 text-muted-foreground flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                  Past Races
              </h2>
              {pastRaces.map(race => (
                  <RaceCard key={race.id} race={race} isPast={true} />
              ))}
          </div>
      )}

      {races.length === 0 && (
          <div className="text-center py-12 bg-card rounded-lg border border-border">
              <p className="text-muted-foreground">No races scheduled yet.</p>
          </div>
      )}
    </div>
  );
}
