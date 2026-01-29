import { useState, useEffect } from 'react';

type ViewMode = 'race' | 'standings' | 'time-trial';

interface ViewModeOptions {
    initialView: string | null;
    cycleTime: number; // Seconds, 0 = disabled
    onSwitch?: () => void;
}

export function useViewMode({ initialView, cycleTime, onSwitch }: ViewModeOptions) {
    const defaultMode: ViewMode = (initialView === 'time-trial')
        ? 'time-trial'
        : (initialView === 'standings') ? 'standings' : 'race';

    const [viewMode, setViewMode] = useState<ViewMode>(defaultMode);

    useEffect(() => {
        if (cycleTime <= 0 || defaultMode === 'time-trial') return;

        const interval = setInterval(() => {
            setViewMode(prev => prev === 'race' ? 'standings' : 'race');
            if (onSwitch) onSwitch();
        }, cycleTime * 1000);

        return () => clearInterval(interval);
    }, [cycleTime, defaultMode, onSwitch]);

    return { viewMode, setViewMode };
}
