'use client';

import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { API_URL } from '@/lib/api';
import type { DualRecordingVerification, WeightVerificationRecord } from '@/types/admin';
import type { DualRecordingResult } from '@/hooks/useDualRecording';

interface UseAdminVerificationsOptions {
    user: User | null;
    raceId: string | null | undefined;
}

export interface UserDirectoryRow {
    userId: string;
    zwiftId: string;
    name: string;
    email: string;
    trainer?: string;
}

export interface DrModalState {
    name: string;
    zwiftId: string;
    activityId?: string;
    verification: DualRecordingVerification;
}

export function useAdminVerifications({ user, raceId }: UseAdminVerificationsOptions) {
    const [drVerifications, setDrVerifications] = useState<Map<string, DualRecordingVerification>>(new Map());
    const [weightVerifications, setWeightVerifications] = useState<Map<string, WeightVerificationRecord>>(new Map());
    const [drModal, setDrModal] = useState<DrModalState | null>(null);
    const [singleDrRunning, setSingleDrRunning] = useState(false);
    const [singleDrStatus, setSingleDrStatus] = useState<{ type: 'info' | 'success' | 'error'; text: string } | null>(null);
    const [drDetailLoading, setDrDetailLoading] = useState(false);
    const [drDetailError, setDrDetailError] = useState<string | null>(null);
    const [drDetailResult, setDrDetailResult] = useState<DualRecordingResult | null>(null);
    const [usersByZwiftId, setUsersByZwiftId] = useState<Map<string, UserDirectoryRow>>(new Map());

    const loadDrVerifications = async (id: string): Promise<Map<string, DualRecordingVerification>> => {
        if (!user) return new Map();
        try {
            const token = await user.getIdToken();
            const res = await fetch(`${API_URL}/admin/races/${id}/dr-verifications`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) return new Map();
            const body = await res.json();
            const map = new Map<string, DualRecordingVerification>();
            (body.verifications ?? []).forEach((v: DualRecordingVerification & { zwiftId?: string | number }) => {
                const key = String(v.zwiftId ?? '');
                if (key) map.set(key, v);
            });
            setDrVerifications(map);
            return map;
        } catch {
            return new Map();
        }
    };

    const loadWeightVerifications = async (id: string): Promise<Map<string, WeightVerificationRecord>> => {
        if (!user) return new Map();
        try {
            const token = await user.getIdToken();
            const res = await fetch(`${API_URL}/admin/races/${id}/weight-verifications`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) return new Map();
            const body = await res.json();
            const map = new Map<string, WeightVerificationRecord>();
            (body.verifications ?? []).forEach((v: WeightVerificationRecord & { zwiftId?: string | number }) => {
                const key = String(v.zwiftId ?? '');
                if (key) map.set(key, v);
            });
            setWeightVerifications(map);
            return map;
        } catch {
            return new Map();
        }
    };

    useEffect(() => {
        if (!raceId || !user) return;
        void loadDrVerifications(raceId);
        void loadWeightVerifications(raceId);
    }, [raceId, user]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!user) return;
        const load = async () => {
            try {
                const token = await user.getIdToken();
                const res = await fetch(`${API_URL}/admin/users`, { headers: { Authorization: `Bearer ${token}` } });
                if (!res.ok) return;
                const body = await res.json();
                const map = new Map<string, UserDirectoryRow>();
                (body.users ?? []).forEach((row: UserDirectoryRow) => {
                    const key = String(row.zwiftId ?? '').trim();
                    if (key) map.set(key, row);
                });
                setUsersByZwiftId(map);
            } catch {
                // Stable fallback — user directory is non-critical
            }
        };
        void load();
    }, [user]);

    const loadDualRecordingDetail = async (
        riderZwiftId: string,
        activityId?: string,
        stravaActivityId?: number | null,
    ) => {
        if (!user) return;
        setDrDetailLoading(true);
        setDrDetailError(null);
        try {
            const token = await user.getIdToken();
            const params = new URLSearchParams();
            if (activityId) params.set('zwiftActivityId', String(activityId));
            if (stravaActivityId != null) params.set('stravaActivityId', String(stravaActivityId));
            if (raceId) params.set('raceId', String(raceId));
            const res = await fetch(
                `${API_URL}/admin/verification/dual-recording/${riderZwiftId}?${params}`,
                { headers: { Authorization: `Bearer ${token}` } },
            );
            const data = await res.json();
            if (!res.ok) {
                setDrDetailResult(null);
                setDrDetailError(data?.message || 'Failed to load DR stream graph');
                return;
            }
            setDrDetailResult(data as DualRecordingResult);

            // Sync summary badge with freshest detail data
            if (raceId) {
                const latest = await loadDrVerifications(raceId);
                const updated = latest.get(riderZwiftId);
                if (updated) {
                    setDrModal(prev => {
                        if (!prev || prev.zwiftId !== riderZwiftId) return prev;
                        const prevKey = `${prev.verification.status}|${prev.verification.verifiedAt}|${prev.verification.stravaActivityId ?? ''}`;
                        const nextKey = `${updated.status}|${updated.verifiedAt}|${updated.stravaActivityId ?? ''}`;
                        return prevKey === nextKey ? prev : { ...prev, verification: updated };
                    });
                }
            }
        } catch {
            setDrDetailResult(null);
            setDrDetailError('Network error while loading DR stream graph');
        } finally {
            setDrDetailLoading(false);
        }
    };

    useEffect(() => {
        if (!drModal) {
            setDrDetailResult(null);
            setDrDetailError(null);
            setDrDetailLoading(false);
            return;
        }
        const stravaId = drModal.verification.stravaActivityId ?? null;
        void loadDualRecordingDetail(drModal.zwiftId, drModal.activityId, stravaId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [drModal?.zwiftId, drModal?.activityId, drModal?.verification?.stravaActivityId, user]);

    const handleRunSingleDR = async () => {
        if (!raceId || !user || !drModal) return;
        setSingleDrRunning(true);
        setSingleDrStatus({ type: 'info', text: 'Running verification for rider...' });
        try {
            const token = await user.getIdToken();
            const res = await fetch(
                `${API_URL}/admin/races/${raceId}/verify-dual-recording/${drModal.zwiftId}`,
                {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ activityId: drModal.activityId || null }),
                },
            );
            const body = await res.json();
            if (!res.ok) {
                setSingleDrStatus({ type: 'error', text: body.message || 'Failed to run verification for rider' });
                return;
            }
            const latest = await loadDrVerifications(raceId);
            const updated = latest.get(drModal.zwiftId);
            if (updated) setDrModal(prev => prev ? { ...prev, verification: updated } : prev);
            const nextStravaId = updated?.stravaActivityId ?? drModal.verification.stravaActivityId ?? null;
            await loadDualRecordingDetail(drModal.zwiftId, drModal.activityId, nextStravaId);
            setSingleDrStatus({ type: 'success', text: body.message || 'Verification completed for rider.' });
        } catch {
            setSingleDrStatus({ type: 'error', text: 'Network error while running verification' });
        } finally {
            setSingleDrRunning(false);
        }
    };

    const openDrModal = (name: string, zwiftId: string, activityId: string | undefined, v: DualRecordingVerification) => {
        setSingleDrStatus(null);
        const fallbackActivityId = activityId || v.activityId || v.zwiftActivityId;
        setDrModal({ name, zwiftId, activityId: fallbackActivityId, verification: v });
    };

    return {
        drVerifications,
        weightVerifications,
        drModal,
        setDrModal,
        singleDrRunning,
        singleDrStatus,
        drDetailLoading,
        drDetailError,
        drDetailResult,
        usersByZwiftId,
        handleRunSingleDR,
        openDrModal,
    };
}
