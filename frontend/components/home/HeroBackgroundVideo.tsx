'use client';

import { HERO_POSTER_URL, HERO_VIDEO_URL } from '@/lib/heroMedia';

interface HeroBackgroundVideoProps {
    /** Tailwind opacity class. Landing uses 50; dashboard/info use 40. */
    opacityClass?: string;
}

export default function HeroBackgroundVideo({
    opacityClass = 'opacity-40',
}: HeroBackgroundVideoProps) {
    return (
        <video
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
            poster={HERO_POSTER_URL}
            className={`absolute inset-0 w-full h-full object-cover z-0 mix-blend-screen bg-black ${opacityClass}`}
        >
            <source src={HERO_VIDEO_URL} type="video/mp4" />
        </video>
    );
}
