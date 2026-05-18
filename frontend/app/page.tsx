'use client';

import { useAuth } from "@/lib/auth-context";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useRacesQuery, useLeagueSettingsQuery } from '@/hooks/queries';
import type { Race } from '@/types/live';
import LandingPage from '@/components/home/LandingPage';
import Dashboard from '@/components/home/Dashboard';


export default function Home() {
    const { user, userCategory, signInWithGoogle, isRegistered, profileLoaded, loading, logOut, authIntent, clearAuthIntent } = useAuth();
    const router = useRouter();
    const [showUnregisteredModal, setShowUnregisteredModal] = useState(false);

    const racesQuery = useRacesQuery();
    const settingsQuery = useLeagueSettingsQuery();

    useEffect(() => {
        if (profileLoaded && user && authIntent === 'login') {
            if (!isRegistered) setShowUnregisteredModal(true);
            clearAuthIntent();
        }
    }, [user, isRegistered, profileLoaded, authIntent, clearAuthIntent]);

    useEffect(() => {
        if (isRegistered && showUnregisteredModal) setShowUnregisteredModal(false);
    }, [isRegistered, showUnregisteredModal]);

    const nextRace = (() => {
        if (!racesQuery.data) return null;
        const now = new Date();
        const upcoming = racesQuery.data
            .filter((r: Race) => new Date(r.date) > now)
            .sort((a: Race, b: Race) => new Date(a.date).getTime() - new Date(b.date).getTime());
        return upcoming[0] ?? null;
    })();

    const leagueSettings = settingsQuery.data
        ? {
              name: settingsQuery.data.name ?? '',
              finishPoints: settingsQuery.data.finishPoints ?? [],
              sprintPoints: settingsQuery.data.sprintPoints ?? [],
              leagueRankPoints: settingsQuery.data.leagueRankPoints ?? [],
              bestRacesCount: settingsQuery.data.bestRacesCount ?? 5,
          }
        : null;

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
