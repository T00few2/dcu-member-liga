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

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useDualRecording(user: User | null, riderId: string | null) {
    const [zwiftActivities, setZwiftActivities] = useState<ZwiftActivity[]>([]);
    const [stravaActivities, setStravaActivities] = useState<StravaMatchActivity[]>([]);
    const [loadingActivities, setLoadingActivities] = useState(false);

    const [selectedZwiftId, setSelectedZwiftId] = useState<string | null>(null);
    const [selectedStravaId, setSelectedStravaId] = useState<number | null>(null);

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

            const res = await fetch(
                `${API_URL}/admin/verification/dual-recording/${riderId}?${params}`,
                { headers },
            );
            const data = await res.json();
            if (res.ok) {
                setResult(data);
                // Record what was auto-matched
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
    }, [user, riderId, authHeader]);

    const reset = useCallback(() => {
        setSelectedZwiftId(null);
        setSelectedStravaId(null);
        setResult(null);
        setError('');
    }, []);

    return {
        zwiftActivities,
        stravaActivities,
        loadingActivities,
        selectedZwiftId,
        setSelectedZwiftId,
        selectedStravaId,
        setSelectedStravaId,
        result,
        loadingComparison,
        error,
        loadActivities,
        fetchComparison,
        reset,
    };
}
