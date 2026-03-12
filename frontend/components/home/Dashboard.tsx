'use client';

import Link from 'next/link';
import { User } from 'firebase/auth';
import ECyclingClubsModal from '@/components/ECyclingClubsModal';
import WelcomeModal from '@/components/WelcomeModal';
import CommunitySection from './CommunitySection';
import NextRaceCard from './NextRaceCard';
import type { Race } from '@/types/live';
import type { LeagueSettings } from '@/types/admin';

interface DashboardProps {
    user: User;
    nextRace: Race | null;
    leagueSettings: LeagueSettings | null;
    userCategory?: string | null;
}

export default function Dashboard({ user, nextRace, leagueSettings, userCategory }: DashboardProps) {
    return (
        <div className="w-full relative -mt-4 text-foreground bg-background">
            {/* Hero */}
            <div className="relative w-full min-h-[50vh] flex flex-col items-center justify-center overflow-hidden bg-black pb-16 pt-8">
                <video autoPlay loop muted playsInline preload="auto" className="absolute inset-0 w-full h-full object-cover z-0 opacity-40 mix-blend-screen bg-black">
                    <source src="/hero-video.mp4" type="video/mp4" />
                </video>
                <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/50 to-background/95 z-0"></div>
                <div className="absolute top-1/4 left-1/4 w-[30rem] h-[30rem] bg-primary/20 rounded-full mix-blend-screen filter blur-[120px] animate-pulse z-0"></div>
                <div className="absolute bottom-1/4 right-1/4 w-[30rem] h-[30rem] bg-white/10 rounded-full mix-blend-screen filter blur-[120px] animate-pulse [animation-delay:2s] z-0"></div>

                <div className="relative z-10 flex flex-col items-center text-center px-4 mt-8 max-w-5xl mx-auto">
                    <h1 className="text-5xl md:text-6xl font-extrabold mb-4 tracking-tight text-white drop-shadow-lg pb-2 animate-in fade-in zoom-in-95 duration-1000">
                        Velkommen tilbage,<br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-white">
                            {user.displayName?.split(' ')[0] || 'Rytter'}
                        </span>
                    </h1>
                    <p className="text-xl mb-8 max-w-2xl text-slate-300 font-light drop-shadow animate-in fade-in slide-in-from-bottom-4 duration-1000 delay-150">
                        Dit dashboard for DCU forårsliga.
                    </p>
                </div>
            </div>

            {/* Content */}
            <div className="container mx-auto px-4 -mt-12 relative z-20 pb-20 animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-300">
                <div className="w-full max-w-4xl mx-auto space-y-8">
                    {nextRace && <NextRaceCard race={nextRace} leagueSettings={leagueSettings} userCategory={userCategory} />}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <Link href="/participants" className="p-6 border border-border rounded-lg shadow-sm hover:shadow-md transition bg-card text-card-foreground group text-left">
                            <h2 className="text-2xl font-semibold mb-2 group-hover:text-primary">Deltagere &rarr;</h2>
                            <p className="text-muted-foreground">Tjek hvem der stiller til start.</p>
                        </Link>
                        <Link href="/results" className="p-6 border border-border rounded-lg shadow-sm hover:shadow-md transition bg-card text-card-foreground group text-left">
                            <h2 className="text-2xl font-semibold mb-2 group-hover:text-primary">Resultater &rarr;</h2>
                            <p className="text-muted-foreground">Se løbsresultater og ligastillingen.</p>
                        </Link>
                        <Link href="/register" className="p-6 border border-border rounded-lg shadow-sm hover:shadow-md transition bg-card text-card-foreground group text-left">
                            <h2 className="text-2xl font-semibold mb-2 group-hover:text-primary">Min Profil &rarr;</h2>
                            <p className="text-muted-foreground">Se og vælg din liga-kategori.</p>
                        </Link>
                        <Link href="/stats" className="p-6 border border-border rounded-lg shadow-sm hover:shadow-md transition bg-card text-card-foreground group text-left">
                            <h2 className="text-2xl font-semibold mb-2 group-hover:text-primary">Min Statistik &rarr;</h2>
                            <p className="text-muted-foreground">Sammenlign din præstation med andre ryttere.</p>
                        </Link>
                    </div>
                </div>
            </div>

            <CommunitySection loggedIn />

            <ECyclingClubsModal isOpen={false} onClose={() => {}} />
            <WelcomeModal />
        </div>
    );
}
