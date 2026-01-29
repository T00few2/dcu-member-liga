import { useState, useEffect } from 'react';
import { doc, onSnapshot, getDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Race, StandingEntry } from '@/types/live';

export function useLiveStandings() {
    const [standings, setStandings] = useState<Record<string, StandingEntry[]>>({});
    const [bestRacesCount, setBestRacesCount] = useState<number>(5);
    const [allRaces, setAllRaces] = useState<Race[]>([]);
    const [leagueName, setLeagueName] = useState<string>('');

    useEffect(() => {
        // Fetch settings once
        const fetchSettings = async () => {
            try {
                 const settingsDoc = await getDoc(doc(db, 'league', 'settings')); 
                 if (settingsDoc.exists()) {
                     const data = settingsDoc.data();
                     if (data?.bestRacesCount) {
                         setBestRacesCount(data.bestRacesCount);
                     }
                     if (data?.name) {
                         setLeagueName(data.name);
                     }
                 }
            } catch (err) {
                console.error("Error fetching settings:", err);
            }
        };
        fetchSettings();

        // Subscribe to standings
        const unsub = onSnapshot(doc(db, 'league', 'standings'), 
            (docSnap) => {
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    if (data.standings) {
                        setStandings(data.standings);
                    }
                }
            }, 
            (err) => {
                console.error("Standings error:", err);
            }
        );

        // Fetch all races for standings display headers
        const fetchAllRaces = async () => {
            try {
                const racesSnapshot = await getDocs(collection(db, 'races'));
                const races = racesSnapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                })) as Race[];
                // Sort by date
                races.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
                setAllRaces(races);
            } catch (err) {
                console.error("Error fetching races:", err);
            }
        };
        fetchAllRaces();

        return () => unsub();
    }, []);

    return { standings, bestRacesCount, allRaces, leagueName };
}
