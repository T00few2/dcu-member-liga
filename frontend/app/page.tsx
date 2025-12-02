'use client';

import { useAuth } from "@/lib/auth-context";
import Link from "next/link";
import { useEffect, useState } from "react";

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

export default function Home() {
  const { user, signInWithGoogle, isRegistered } = useAuth();
  const [nextRace, setNextRace] = useState<Race | null>(null);

  useEffect(() => {
      const fetchNextRace = async () => {
          if (!user || !isRegistered) return;
          try {
              const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
              const token = await user.getIdToken();
              const res = await fetch(`${apiUrl}/races`, {
                  headers: { 'Authorization': `Bearer ${token}` }
              });
              if (res.ok) {
                  const data = await res.json();
                  const now = new Date();
                  const upcoming = (data.races || [])
                      .filter((r: Race) => new Date(r.date) > now)
                      .sort((a: Race, b: Race) => new Date(a.date).getTime() - new Date(b.date).getTime());
                  
                  if (upcoming.length > 0) {
                      setNextRace(upcoming[0]);
                  }
              }
          } catch (e) {
              console.error('Error fetching next race', e);
          }
      };
      fetchNextRace();
  }, [user, isRegistered]);

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center px-4">
      <h1 className="text-4xl font-bold mb-4 text-foreground">Welcome to DCU Member League</h1>
      <p className="text-xl mb-8 max-w-2xl text-foreground opacity-80">
        The official e-cycling league for DCU members. Join the competition, view participants, and track race results.
      </p>
      
      {!user ? (
        <div className="bg-card text-card-foreground p-8 rounded-lg shadow-md border border-border max-w-md w-full">
          <h2 className="text-2xl font-semibold mb-4">Join the League</h2>
          <p className="text-muted-foreground mb-6">Sign in to register your license and view your stats.</p>
          <button 
            onClick={signInWithGoogle}
            className="w-full bg-primary text-primary-foreground py-3 px-4 rounded-lg font-medium hover:opacity-90 transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Sign in with Google
          </button>
        </div>
      ) : (
        <div className="w-full max-w-4xl space-y-8">
            {nextRace && (
                <div>
                    <div className="flex justify-between items-end mb-2">
                        <div className="text-primary text-sm font-bold uppercase tracking-wider">Next Race</div>
                        <Link 
                            href="/schedule" 
                            className="text-sm text-primary hover:underline"
                        >
                            View Full Schedule &rarr;
                        </Link>
                    </div>
                    <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden p-6 text-left">
                        <div className="flex flex-col md:flex-row justify-between md:items-start gap-4 mb-4">
                            <div>
                                <div className="text-sm font-medium text-primary mb-1">
                                    {new Date(nextRace.date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                                </div>
                                <h3 className="text-2xl font-bold text-card-foreground">{nextRace.name}</h3>
                                <div className="text-muted-foreground text-sm mt-1">
                                    Start: {new Date(nextRace.date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                                </div>
                            </div>
                            <div className="bg-muted/30 px-4 py-2 rounded-lg text-right">
                                <div className="font-semibold text-card-foreground">{nextRace.map}</div>
                                <div className="text-sm text-muted-foreground flex items-center justify-end gap-1">
                                    {nextRace.routeName}
                                    <a 
                                        href={getZwiftInsiderUrl(nextRace.routeName)} 
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
                                <div className="font-semibold text-card-foreground">{nextRace.totalDistance} km</div>
                            </div>
                            <div className="bg-muted/20 p-3 rounded text-center">
                                <div className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Elevation</div>
                                <div className="font-semibold text-card-foreground">{nextRace.totalElevation} m</div>
                            </div>
                            <div className="bg-muted/20 p-3 rounded text-center">
                                <div className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Laps</div>
                                <div className="font-semibold text-card-foreground">{nextRace.laps}</div>
                            </div>
                        </div>

                        {nextRace.sprints && nextRace.sprints.length > 0 && (
                            <div className="border-t border-border pt-4">
                                <h4 className="text-sm font-semibold text-card-foreground mb-3">Points Sprints</h4>
                                <div className="space-y-3">
                                    {/* Group by lap for display */}
                                    {Object.entries(
                                        nextRace.sprints.reduce((acc, seg) => {
                                            const lap = seg.lap || 1;
                                            if (!acc[lap]) acc[lap] = [];
                                            acc[lap].push(seg);
                                            return acc;
                                        }, {} as Record<number, Segment[]>)
                                    )
                                    .sort(([a], [b]) => parseInt(a) - parseInt(b))
                                    .map(([lapKey, segments]) => (
                                        <div key={lapKey} className="flex flex-col sm:flex-row gap-2 sm:gap-8 text-sm">
                                            <div className="w-16 font-medium text-muted-foreground shrink-0">Lap {lapKey}</div>
                                            <div className="flex-1 flex flex-wrap gap-2">
                                                {segments.sort((a, b) => a.count - b.count).map((seg, idx) => (
                                                    <span key={idx} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                                                        {seg.name}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Link href="/participants" className="p-6 border border-border rounded-lg shadow-sm hover:shadow-md transition bg-card text-card-foreground group text-left">
                    <h2 className="text-2xl font-semibold mb-2 group-hover:text-primary">Participants &rarr;</h2>
                    <p className="text-muted-foreground">
                    Check out the competition.
                    </p>
                </Link>
                
                <Link href="/results" className="p-6 border border-border rounded-lg shadow-sm hover:shadow-md transition bg-card text-card-foreground group text-left">
                    <h2 className="text-2xl font-semibold mb-2 group-hover:text-primary">Results &rarr;</h2>
                    <p className="text-muted-foreground">
                    View race results and league standings.
                    </p>
                </Link>

                <Link href="/stats" className="p-6 border border-border rounded-lg shadow-sm hover:shadow-md transition bg-card text-card-foreground group text-left md:col-span-2">
                    <h2 className="text-2xl font-semibold mb-2 group-hover:text-primary">My Stats &rarr;</h2>
                    <p className="text-muted-foreground">
                    Compare your performance against other riders.
                    </p>
                </Link>
            </div>
        </div>
      )}
    </div>
  );
}
