import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import HeroBackgroundVideo from '@/components/home/HeroBackgroundVideo';
import { HERO_POSTER_URL, HERO_VIDEO_URL } from '@/lib/heroMedia';

describe('HeroBackgroundVideo', () => {
    it('loads the hero clip from Firebase Storage, not Vercel public/', () => {
        const { container } = render(<HeroBackgroundVideo />);
        const source = container.querySelector('source');
        const video = container.querySelector('video');

        expect(HERO_VIDEO_URL).toContain('firebasestorage.googleapis.com');
        expect(source?.getAttribute('src')).not.toBe('/hero-video.mp4');
        expect(source?.getAttribute('src')).toBe(HERO_VIDEO_URL);
        expect(video?.getAttribute('poster')).toBe(HERO_POSTER_URL);
        expect(video?.getAttribute('preload')).toBe('metadata');
    });
});
