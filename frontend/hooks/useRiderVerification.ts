import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { API_URL } from '@/lib/api';

export interface Participant {
    name: string;
    zwiftId: string;
    category: string;
    ftp: string;
    rating: string;
}

export interface ZwiftPowerResult {
    date: number | string;
    event_title: string;
    avg_watts: number;
    avg_hr: number;
    wkg: number;
    category: string;
    weight: number;
    height: number;
    cp_curve: { [key: string]: number };
}

export interface StravaActivity {
    id: number;
    name: string;
    date: string;
    distance: number;
    moving_time: number;
    average_watts?: number;
    average_heartrate?: number;
    suffer_score?: number;
}

export interface StravaStream {
    time: number;
    timeLabel: string;
    watts: number;
    cadence: number;
    altitude: number;
}

export function useRiderVerification(user: User | null) {
    const [participants, setParticipants] = useState<Participant[]>([]);
    const [loadingList, setLoadingList] = useState(true);
    const [selectedRider, setSelectedRider] = useState<Participant | null>(null);
    const [loadingDetails, setLoadingDetails] = useState(false);
    const [zpData, setZpData] = useState<ZwiftPowerResult[]>([]);
    const [stravaData, setStravaData] = useState<StravaActivity[]>([]);
    const [riderProfile, setRiderProfile] = useState<any>(null);
    const [error, setError] = useState('');
    const [selectedStravaActivityId, setSelectedStravaActivityId] = useState<number | null>(null);
    const [stravaStreams, setStravaStreams] = useState<StravaStream[]>([]);
    const [loadingStreams, setLoadingStreams] = useState(false);

    useEffect(() => {
        if (!user) return;
        const fetchParticipants = async () => {
            try {
                const token = await user.getIdToken();
                const res = await fetch(`${API_URL}/participants`, {
                    headers: { 'Authorization': `Bearer ${token}` },
                });
                if (res.ok) {
                    const data = await res.json();
                    setParticipants(data.participants || []);
                }
            } catch (e) {
                console.error("Error loading participants", e);
            } finally {
                setLoadingList(false);
            }
        };
        fetchParticipants();
    }, [user]);

    const selectRider = async (rider: Participant) => {
        setSelectedRider(rider);
        setLoadingDetails(true);
        setError('');
        setZpData([]);
        setStravaData([]);
        setRiderProfile(null);
        setSelectedStravaActivityId(null);
        setStravaStreams([]);

        if (!user) return;

        try {
            const token = await user.getIdToken();
            const res = await fetch(`${API_URL}/admin/verification/rider/${rider.zwiftId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                const toEpoch = (value: unknown): number => {
                    if (typeof value === 'number') return value;
                    if (typeof value === 'string') {
                        const parsed = Date.parse(value);
                        return Number.isNaN(parsed) ? 0 : parsed;
                    }
                    return 0;
                };
                setZpData((data.zwiftPowerHistory || []).sort((a: ZwiftPowerResult, b: ZwiftPowerResult) => toEpoch(a.date) - toEpoch(b.date)));
                setStravaData(data.stravaActivities || []);
                setRiderProfile(data.profile || {});
            } else {
                const err = await res.json();
                setError(err.message || 'Failed to fetch rider data');
            }
        } catch (e) {
            setError('Network error fetching rider data');
            console.error(e);
        } finally {
            setLoadingDetails(false);
        }
    };

    const selectStravaActivity = async (activity: StravaActivity) => {
        if (activity.id === selectedStravaActivityId) return;
        setSelectedStravaActivityId(activity.id);
        setLoadingStreams(true);
        setStravaStreams([]);

        if (!user || !selectedRider) return;

        try {
            const token = await user.getIdToken();
            const res = await fetch(
                `${API_URL}/admin/verification/strava/streams/${activity.id}?zwiftId=${selectedRider.zwiftId}`,
                { headers: { 'Authorization': `Bearer ${token}` } }
            );
            if (res.ok) {
                const data = await res.json();
                const streams = data.streams;
                const timeStream = streams.find((s: any) => s.type === 'time')?.data || [];
                const wattsStream = streams.find((s: any) => s.type === 'watts')?.data || [];
                const cadenceStream = streams.find((s: any) => s.type === 'cadence')?.data || [];
                const altitudeStream = streams.find((s: any) => s.type === 'altitude')?.data || [];
                setStravaStreams(timeStream.map((t: number, i: number) => ({
                    time: t,
                    timeLabel: new Date(t * 1000).toISOString().substr(11, 8),
                    watts: wattsStream[i] || 0,
                    cadence: cadenceStream[i] || 0,
                    altitude: altitudeStream[i] || 0
                })));
            } else {
                console.error("Failed to load streams");
            }
        } catch (e) {
            console.error("Error fetching streams", e);
        } finally {
            setLoadingStreams(false);
        }
    };

    return {
        participants,
        loadingList,
        selectedRider,
        loadingDetails,
        zpData,
        stravaData,
        riderProfile,
        error,
        selectedStravaActivityId,
        stravaStreams,
        loadingStreams,
        selectRider,
        selectStravaActivity,
    };
}
