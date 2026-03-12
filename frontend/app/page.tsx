'use client';

import { useAuth } from "@/lib/auth-context";
import { useEffect, useState } from "react";
import { API_URL } from '@/lib/api';
import { useRouter } from "next/navigation";
import type { Race } from '@/types/live';
import type { LeagueSettings } from '@/types/admin';
import LandingPage from '@/components/home/LandingPage';
import Dashboard from '@/components/home/Dashboard';


export default function Home() {
    const { user, userCategory, signInWithGoogle, isRegistered, profileLoaded, loading, logOut, authIntent, clearAuthIntent } = useAuth();
    const router = useRouter();
    const [nextRace, setNextRace] = useState<Race | null>(null);
    const [leagueSettings, setLeagueSettings] = useState<LeagueSettings | null>(null);
    const [showUnregisteredModal, setShowUnregisteredModal] = useState(false);

    useEffect(() => {
        if (profileLoaded && user && authIntent === 'login') {
            if (!isRegistered) setShowUnregisteredModal(true);
            clearAuthIntent();
        }
    }, [user, isRegistered, profileLoaded, authIntent, clearAuthIntent]);

    useEffect(() => {
        if (isRegistered && showUnregisteredModal) setShowUnregisteredModal(false);
    }, [isRegistered, showUnregisteredModal]);

    useEffect(() => {
        if (!user || !isRegistered) return;
        const fetchNextRace = async () => {
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
                    const now = new Date();
                    const upcoming = (data.races || [])
                        .filter((r: Race) => new Date(r.date) > now)
                        .sort((a: Race, b: Race) => new Date(a.date).getTime() - new Date(b.date).getTime());
                    if (upcoming.length > 0) setNextRace(upcoming[0]);
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
                console.error('Error fetching next race', e);
            }
        };
        fetchNextRace();
    }, [user, isRegistered]);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="animate-pulse flex flex-col items-center gap-4">
                    <div className="w-12 h-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin"></div>
                    <p className="text-muted-foreground text-sm font-medium">Loading...</p>
                </div>
            </div>
        );
    }

    if (!user || !isRegistered) {
        return (
            <LandingPage
                showUnregisteredModal={showUnregisteredModal}
                isRegistered={isRegistered}
                onSignInWithGoogle={() => signInWithGoogle('register')}
                onCloseUnregisteredModal={() => { setShowUnregisteredModal(false); if (!isRegistered) logOut(); }}
                onStartRegistration={async () => {
                    setShowUnregisteredModal(false);
                    await logOut();
                }}
            />
        );
    }

    return <Dashboard user={user} nextRace={nextRace} leagueSettings={leagueSettings} userCategory={userCategory} />;
}
