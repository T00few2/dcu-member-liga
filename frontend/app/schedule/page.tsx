'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import type { Race } from '@/types/live';
import type { LeagueSettings } from '@/types/admin';
import { API_URL } from '@/lib/api';
import RaceCard from '@/components/races/RaceCard';

export default function SchedulePage() {
    const { user, userCategory, loading: authLoading, isRegistered } = useAuth();
    const [races, setRaces] = useState<Race[]>([]);
    const [leagueSettings, setLeagueSettings] = useState<LeagueSettings>({
        finishPoints: [],
        sprintPoints: [],
        leagueRankPoints: [],
        bestRacesCount: 5,
    });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchRaces = async () => {
            if (!user) return;
            try {
                const token = await user.getIdToken();
                const [racesRes, settingsRes] = await Promise.all([
                    fetch(`${API_URL}/races`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    }),
                    fetch(`${API_URL}/league/settings`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    }),
                ]);

                if (racesRes.ok) {
                    const data = await racesRes.json();
                    // Sort by date ascending
                    const sorted = (data.races || []).sort((a: Race, b: Race) =>
                        new Date(a.date).getTime() - new Date(b.date).getTime()
                    );
                    setRaces(sorted);
                }

                if (settingsRes.ok) {
                    const settingsData = await settingsRes.json();
                    const settings = settingsData.settings || {};
                    setLeagueSettings({
                        name: settings.name || '',
                        finishPoints: settings.finishPoints || [],
                        sprintPoints: settings.sprintPoints || [],
                        leagueRankPoints: settings.leagueRankPoints || [],
                        bestRacesCount: settings.bestRacesCount || 5,
                    });
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
        return <div className="p-8 text-center text-muted-foreground">Indlæser kalender...</div>;
    }

    if (!isRegistered) return null;

    const futureRaces = races.filter(r => new Date(r.date) > new Date());
    const pastRaces = races.filter(r => new Date(r.date) <= new Date()).reverse();

    return (
        <div className="max-w-4xl mx-auto px-4 py-8">
            <h1 className="text-3xl font-bold mb-8 text-foreground">Ligakalender</h1>

            {futureRaces.length > 0 && (
                <div className="mb-12">
                    <h2 className="text-xl font-semibold mb-6 text-muted-foreground flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-green-500"></span>
                        Kommende løb
                    </h2>
                    {futureRaces.map(race => (
                        <RaceCard
                            key={race.id}
                            race={race}
                            leagueSettings={leagueSettings}
                            userCategory={userCategory}
                        />
                    ))}
                </div>
            )}

            {pastRaces.length > 0 && (
                <div>
                    <h2 className="text-xl font-semibold mb-6 text-muted-foreground flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                        Tidligere løb
                    </h2>
                    {pastRaces.map(race => (
                        <RaceCard
                            key={race.id}
                            race={race}
                            leagueSettings={leagueSettings}
                            userCategory={userCategory}
                            isPast={true}
                            showPointsSplit={false}
                        />
                    ))}
                </div>
            )}

            {races.length === 0 && (
                <div className="text-center py-12 bg-card rounded-lg border border-border">
                    <p className="text-muted-foreground">Ingen planlagte løb endnu.</p>
                </div>
            )}
        </div>
    );
}
