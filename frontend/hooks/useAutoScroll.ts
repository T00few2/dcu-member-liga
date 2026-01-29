import { useEffect, RefObject } from 'react';

interface AutoScrollOptions {
    enabled: boolean;
    speed?: number; // px per tick
    tickMs?: number;
    pauseMs?: number;
    dependencies?: any[]; // Re-run effect when these change
}

export function useAutoScroll(
    containerRef: RefObject<HTMLDivElement | null>,
    { enabled, speed = 1, tickMs = 50, pauseMs = 3000, dependencies = [] }: AutoScrollOptions
) {
    useEffect(() => {
        if (!enabled || !containerRef.current) return;

        const scrollContainer = containerRef.current;
        let scrollPos = 0;
        let direction = 1; // 1 = down, -1 = up
        let intervalId: ReturnType<typeof setInterval> | null = null;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        const stopInterval = () => {
            if (intervalId) {
                clearInterval(intervalId);
                intervalId = null;
            }
        };

        const startInterval = () => {
            if (intervalId) return;
            intervalId = setInterval(() => {
                // Only scroll if content overflows
                if (scrollContainer.scrollHeight <= scrollContainer.clientHeight) return;

                scrollPos += speed * direction;
                const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;

                if (scrollPos >= maxScroll) {
                    scrollPos = maxScroll;
                    scrollContainer.scrollTop = scrollPos;
                    stopInterval();
                    timeoutId = setTimeout(() => {
                        direction = -1;
                        startInterval();
                    }, pauseMs);
                    return;
                }

                if (scrollPos <= 0) {
                    scrollPos = 0;
                    scrollContainer.scrollTop = scrollPos;
                    stopInterval();
                    timeoutId = setTimeout(() => {
                        direction = 1;
                        startInterval();
                    }, pauseMs);
                    return;
                }

                scrollContainer.scrollTop = scrollPos;
            }, tickMs);
        };

        scrollContainer.scrollTop = 0;
        scrollPos = 0;
        timeoutId = setTimeout(() => {
            startInterval();
        }, pauseMs);

        return () => {
            stopInterval();
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        };
    }, [enabled, ...dependencies]);
}
