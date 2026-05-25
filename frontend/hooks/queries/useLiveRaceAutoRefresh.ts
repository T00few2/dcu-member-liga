'use client';

import { useEffect } from 'react';
import { API_URL } from '@/lib/api';

interface UseLiveRaceAutoRefreshOptions {
    enabled: boolean;
    intervalSeconds: number;
}

export function useLiveRaceAutoRefresh({ enabled, intervalSeconds }: UseLiveRaceAutoRefreshOptions) {
    useEffect(() => {
        if (!enabled || intervalSeconds <= 0) return;

        const tick = () => {
            fetch(`${API_URL}/live-race/active/results/refresh`, { method: 'POST' }).catch(() => {});
        };

        tick();
        const id = setInterval(tick, intervalSeconds * 1000);
        return () => clearInterval(id);
    }, [enabled, intervalSeconds]);
}
