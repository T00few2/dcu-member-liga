'use client';

import { useState, useCallback } from 'react';
import { User } from 'firebase/auth';
import { API_URL } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ZwiftActivity {
    activityId: string;
    startedAt: string | null;
    name: string;
    durationMs: number;
    avgWatts: number | null;
    sport: string;
}

export interface StravaMatchActivity {
    id: number;
    name: string;
    startDate: string;       // UTC ISO-8601
    startDateLocal: string;
    durationSec: number;
    movingTimeSec: number;
    averageWatts: number | null;
    averageHeartrate: number | null;
    distanceM: number;
    sport: string;
    hasPowerMeter: boolean;
}

export interface CpDiffRow {
    label: string;   // "5s", "1m", …
    key: string;     // "w5", "w60", …
    zwift: number | null;
    strava: number | null;
    diffW: number;
    diffPct: number | null;
}

export interface DualRecordingResult {
    zwift: {
        activityId: string;
        startedAt: string | null;
        durationSec: number | null;
        avgWatts: number | null;
        cpCurve: Record<string, number>;
    };
    strava: {
        activityId: number | null;
        name: string;
        startedAt: string;
        durationSec: number | null;
        avgWattsRaw: number | null;
        avgWattsSynced: number | null;
        cpCurveRaw: Record<string, number>;
        cpCurveSynced: Record<string, number>;
        streams: {
            time: number[];
            watts: number[];
            cadence: number[];
            heartrate: number[];
            altitude: number[];
        };
    } | null;
    sync: {
        offsetSec: number;
        zwiftDurationSec: number | null;
        stravaWindowStart: number;
        stravaWindowEnd: number;
    } | null;
    comparison: {
        cpDiff: CpDiffRow[];
        avgPower: {
            zwift: number | null;
            strava: number | null;
            diffW: number | null;
            diffPct: number | null;
        };
    } | null;
    warning?: string;
}

export interface EventActivityResult {
    found: boolean;
    message?: string;
    eventStartIso?: string;
    subgroupLabel?: string;
    riderResult?: { durationSec: number | null; avgWatts: number | null };
    zwiftActivity?: {
        activityId: string;
        startedAt: string | null;
        durationSec: number | null;
        avgWatts: number | null;
    } | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useDualRecording(user: User | null, riderId: string | null) {
    const [zwiftActivities, setZwiftActivities] = useState<ZwiftActivity[]>([]);
    const [stravaActivities, setStravaActivities] = useState<StravaMatchActivity[]>([]);
    const [loadingActivities, setLoadingActivities] = useState(false);

    const [selectedZwiftId, setSelectedZwiftId] = useState<string | null>(null);
    const [selectedStravaId, setSelectedStravaId] = useState<number | null>(null);

    // Event-based lookup
    const [eventId, setEventId] = useState('');
    const [loadingEventActivity, setLoadingEventActivity] = useState(false);
    const [eventActivityResult, setEventActivityResult] = useState<EventActivityResult | null>(null);
    const [eventStartIso, setEventStartIso] = useState<string | null>(null);

    const [result, setResult] = useState<DualRecordingResult | null>(null);
    const [loadingComparison, setLoadingComparison] = useState(false);
    const [error, setError] = useState('');

    const authHeader = useCallback(async (): Promise<Record<string, string>> => {
        if (!user) return {};
        const token = await user.getIdToken();
        return { Authorization: `Bearer ${token}` };
    }, [user]);

    const loadActivities = useCallback(async () => {
        if (!user || !riderId) return;
        setLoadingActivities(true);
        setError('');
        try {
            const headers = await authHeader();
            const [zRes, sRes] = await Promise.all([
                fetch(`${API_URL}/admin/verification/zwift-activities/${riderId}`, { headers }),
                fetch(`${API_URL}/admin/verification/strava-activities/${riderId}`, { headers }),
            ]);
            if (zRes.ok) {
                const d = await zRes.json();
                setZwiftActivities(d.activities || []);
            }
            if (sRes.ok) {
                const d = await sRes.json();
                setStravaActivities(d.activities || []);
            }
        } catch (e) {
            console.error('Error loading activities for dual recording', e);
        } finally {
            setLoadingActivities(false);
        }
    }, [user, riderId, authHeader]);

    const loadEventActivity = useCallback(async (lookupEventId: string) => {
        if (!user || !riderId || !lookupEventId.trim()) return;
        setLoadingEventActivity(true);
        setError('');
        setEventActivityResult(null);
        try {
            const headers = await authHeader();
            const params = new URLSearchParams({ eventId: lookupEventId.trim() });
            const res = await fetch(
                `${API_URL}/admin/verification/event-activity/${riderId}?${params}`,
                { headers },
            );
            const data: EventActivityResult = await res.json();
            setEventActivityResult(data);
            if (data.found) {
                setEventStartIso(data.eventStartIso ?? null);
                if (data.zwiftActivity?.activityId) {
                    setSelectedZwiftId(data.zwiftActivity.activityId);
                }
            }
        } catch (e) {
            console.error('Error loading event activity', e);
            setEventActivityResult({ found: false, message: 'Network error' });
        } finally {
            setLoadingEventActivity(false);
        }
    }, [user, riderId, authHeader]);

    const fetchComparison = useCallback(async (
        zwiftActivityId: string,
        stravaActivityId?: number | null,
    ) => {
        if (!user || !riderId) return;
        setLoadingComparison(true);
        setError('');
        setResult(null);
        try {
            const headers = await authHeader();
            const params = new URLSearchParams({ zwiftActivityId });
            if (stravaActivityId) params.set('stravaActivityId', String(stravaActivityId));
            if (eventStartIso) params.set('eventStartIso', eventStartIso);

            const res = await fetch(
                `${API_URL}/admin/verification/dual-recording/${riderId}?${params}`,
                { headers },
            );
            const data = await res.json();
            if (res.ok) {
                setResult(data);
                if (data.strava?.activityId) setSelectedStravaId(data.strava.activityId);
            } else {
                setError(data.message || 'Failed to fetch comparison');
            }
        } catch (e) {
            setError('Network error fetching dual recording');
            console.error(e);
        } finally {
            setLoadingComparison(false);
        }
    }, [user, riderId, authHeader, eventStartIso]);

    const reset = useCallback(() => {
        setSelectedZwiftId(null);
        setSelectedStravaId(null);
        setResult(null);
        setError('');
        setEventId('');
        setEventActivityResult(null);
        setEventStartIso(null);
    }, []);

    return {
        zwiftActivities,
        stravaActivities,
        loadingActivities,
        selectedZwiftId,
        setSelectedZwiftId,
        selectedStravaId,
        setSelectedStravaId,
        // Event-based lookup
        eventId,
        setEventId,
        loadingEventActivity,
        eventActivityResult,
        loadEventActivity,
        result,
        loadingComparison,
        error,
        loadActivities,
        fetchComparison,
        reset,
    };
}
