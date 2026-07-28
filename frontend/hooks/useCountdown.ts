'use client';

import { useEffect, useState } from 'react';

export type CountdownParts = {
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
    totalSeconds: number;
    isPast: boolean;
};

function partsFromTarget(target: Date | null): CountdownParts {
    if (!target) {
        return { days: 0, hours: 0, minutes: 0, seconds: 0, totalSeconds: 0, isPast: true };
    }
    const totalSeconds = Math.max(0, Math.floor((target.getTime() - Date.now()) / 1000));
    return {
        days: Math.floor(totalSeconds / 86400),
        hours: Math.floor((totalSeconds % 86400) / 3600),
        minutes: Math.floor((totalSeconds % 3600) / 60),
        seconds: totalSeconds % 60,
        totalSeconds,
        isPast: totalSeconds <= 0,
    };
}

export function useCountdown(targetDate: Date | null): CountdownParts {
    const [parts, setParts] = useState(() => partsFromTarget(targetDate));

    useEffect(() => {
        if (!targetDate) {
            setParts(partsFromTarget(null));
            return;
        }
        const tick = () => setParts(partsFromTarget(targetDate));
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [targetDate]);

    return parts;
}

export function formatCountdownText(parts: CountdownParts): string {
    const { days, hours, minutes, seconds, totalSeconds } = parts;
    if (totalSeconds < 86400) {
        return `${hours}t ${minutes}m ${seconds}s`;
    }
    return `${days}d ${hours}t ${minutes}m`;
}
