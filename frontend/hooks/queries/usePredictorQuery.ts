'use client';

import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';
import type {
    FeatureKey,
    FeatureMeta,
    Inputs,
    ModelResult,
    PredictionMap,
} from '@/components/admin/category-predictor/shared';

/** Saved predictor settings (admin-only `predictor_settings/current.config`). */
export interface PredictorConfig {
    features: Record<FeatureKey, boolean>;
    regression: 'ols' | 'ridge';
    ridgeLambda: number;
    stravaWindowDays: 30 | 60 | 90;
    stravaPowerScale: Record<'wkg5s' | 'wkg1m' | 'wkg5m' | 'wkg20m', number>;
    minStravaActivities: number;
    /** Train only on riders with a reliable vELO (at least this many Zwift rides); 0 = all riders. */
    trainingMinRides?: number;
    /** Own outdoor→indoor correction for outdoor rides marked as a race on Strava; null = same as other outdoor rides. */
    outdoorRaceScale?: Record<'wkg5s' | 'wkg1m' | 'wkg5m' | 'wkg20m', number> | null;
    /** "velo_or_league": riders without a reliable vELO are trained on their league results instead. */
    targetSource?: 'velo' | 'velo_or_league';
    /** Leave out league rows whose weight was not recorded before the race. */
    strictPointInTime?: boolean;
    /** Riders with at least this many indoor rides in the Strava window are rated on indoor power alone; 0 = off. */
    indoorFirstMinRides?: number;
}

export interface PredictorHistoryEntry {
    config: PredictorConfig;
    metrics?: Record<string, unknown> | null;
    replacedAt?: string;
    replacedBy?: string;
    reason?: string;
}

export interface PredictorConfigResponse {
    config: PredictorConfig;
    metrics: Record<string, unknown> | null;
    history: PredictorHistoryEntry[];
    updatedAt?: string | null;
}

export interface PredictorModelResponse {
    model: ModelResult | null;
    config: PredictorConfig;
    defaultFeatures: Record<FeatureKey, boolean>;
    features: FeatureMeta[];
    /** Zwift-power prediction for every rider, keyed by Zwift ID. */
    predictions: PredictionMap;
}

export interface PredictRow {
    id: string;
    inputs: Inputs;
    source?: 'zwift' | 'strava';
    activityCount?: number | null;
}

async function postJson<T>(path: string, token: string, body: unknown): Promise<T> {
    const res = await fetch(`${API_URL}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message ?? `Request failed (${res.status})`);
    return data as T;
}

/** Delay a fast-changing value (typed inputs, toggles) before it triggers a request. */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const id = setTimeout(() => setDebounced(value), delayMs);
        return () => clearTimeout(id);
    }, [value, delayMs]);
    return debounced;
}

export function usePredictorConfigQuery() {
    const { user } = useAuth();
    return useQuery<PredictorConfigResponse>({
        queryKey: ['predictor', 'config'],
        queryFn: async () => {
            const token = await user!.getIdToken();
            const res = await fetch(`${API_URL}/admin/predictor/config`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error('Failed to fetch predictor config');
            return res.json();
        },
        enabled: !!user,
        staleTime: 5 * 60_000,
    });
}

/**
 * Fitted model and every rider's Zwift prediction from the backend predictor.
 * `features` previews an unsaved feature selection; null uses the saved config.
 */
export function usePredictorModelQuery(features: Record<FeatureKey, boolean> | null) {
    const { user } = useAuth();
    return useQuery<PredictorModelResponse>({
        queryKey: ['predictor', 'model', features],
        queryFn: async () => {
            const token = await user!.getIdToken();
            return postJson<PredictorModelResponse>(
                '/admin/predictor/model',
                token,
                features ? { config: { features } } : {},
            );
        },
        enabled: !!user,
        staleTime: 60_000,
        placeholderData: keepPreviousData,
    });
}

/** Predictions for typed or Strava inputs, batched into one request. */
export function usePredictionsQuery(rows: PredictRow[], features: Record<FeatureKey, boolean> | null) {
    const { user } = useAuth();
    return useQuery<PredictionMap>({
        queryKey: ['predictor', 'predict', features, rows],
        queryFn: async () => {
            const token = await user!.getIdToken();
            const data = await postJson<{ predictions: PredictionMap }>(
                '/admin/predictor/predict',
                token,
                { rows, ...(features ? { config: { features } } : {}) },
            );
            return data.predictions ?? {};
        },
        enabled: !!user && rows.length > 0,
        staleTime: 60_000,
        placeholderData: keepPreviousData,
    });
}
