import { useState, useEffect, RefObject } from 'react';

interface FitToScreenOptions {
    enabled: boolean;
    isFull: boolean;
    dependencies?: any[];
}

export function useFitToScreen(
    wrapperRef: RefObject<HTMLDivElement | null>,
    containerRef: RefObject<HTMLDivElement | null>,
    { enabled, isFull, dependencies = [] }: FitToScreenOptions
) {
    const [fitScale, setFitScale] = useState(1);

    useEffect(() => {
        if (!enabled || !isFull || !wrapperRef.current || !containerRef.current) {
            setFitScale(1);
            return;
        }

        const calculateScale = () => {
            const wrapper = wrapperRef.current;
            const container = containerRef.current;
            if (!wrapper || !container) return;

            // Temporarily remove transform to measure true content height
            const originalTransform = wrapper.style.transform;
            wrapper.style.transform = 'none';
            
            // Force reflow to get accurate measurement
            void wrapper.offsetHeight;
            
            // Get the natural height of the table content (unscaled)
            const contentHeight = wrapper.scrollHeight;
            // Get the available height in the container
            const availableHeight = container.clientHeight;

            // Restore original transform
            wrapper.style.transform = originalTransform;

            if (contentHeight <= availableHeight || contentHeight === 0) {
                setFitScale(1);
            } else {
                // Calculate scale to fit, with a minimum of 0.3
                const scale = Math.max(0.3, availableHeight / contentHeight);
                setFitScale(scale);
            }
        };

        // Calculate after a short delay to ensure content is rendered
        const timeoutId = setTimeout(calculateScale, 50);
        
        // Recalculate on window resize
        window.addEventListener('resize', calculateScale);
        
        return () => {
            clearTimeout(timeoutId);
            window.removeEventListener('resize', calculateScale);
        };
    }, [enabled, isFull, ...dependencies]);

    return fitScale;
}
