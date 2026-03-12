'use client';

import Link from 'next/link';
import type { Race } from '@/types/live';
import type { LeagueSettings } from '@/types/admin';
import RaceCard from '@/components/races/RaceCard';

interface NextRaceCardProps {
    race: Race;
    leagueSettings: LeagueSettings | null;
    userCategory?: string | null;
}

export default function NextRaceCard({ race, leagueSettings, userCategory }: NextRaceCardProps) {
    return (
        <div>
            <div className="flex justify-between items-end mb-2">
                <div className="text-primary text-sm font-bold uppercase tracking-wider">Næste Løb</div>
                <Link href="/schedule" className="text-sm text-primary hover:underline">
                    Se hele løbskalenderen &rarr;
                </Link>
            </div>
            <RaceCard race={race} leagueSettings={leagueSettings} userCategory={userCategory} />
        </div>
    );
}
