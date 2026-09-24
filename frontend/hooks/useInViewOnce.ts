'use client';

import { useEffect, useState, type RefObject } from 'react';

/** True after the element has intersected the viewport once (stays true). */
export function useInViewOnce(
    ref: RefObject<Element | null>,
    rootMargin = '240px',
): boolean {
    const [inView, setInView] = useState(false);

    useEffect(() => {
        if (inView) return;
        const el = ref.current;
        if (!el) return;
        if (typeof IntersectionObserver === 'undefined') {
            setInView(true);
            return;
        }

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry?.isIntersecting) setInView(true);
            },
            { rootMargin },
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [inView, ref, rootMargin]);

    return inView;
}
