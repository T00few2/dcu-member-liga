import { describe, expect, it } from 'vitest';
import { coverObjectPosition, panCoverByPixels } from '@/lib/coverPosition';

describe('coverObjectPosition', () => {
    it('centers when the post has no saved crop', () => {
        expect(coverObjectPosition(null)).toBe('50% 50%');
        expect(coverObjectPosition({})).toBe('50% 50%');
    });

    it('clamps the saved point into the frame', () => {
        expect(coverObjectPosition({ x: -10, y: 140 })).toBe('0% 100%');
    });
});

describe('panCoverByPixels', () => {
    const tall = { frameW: 400, frameH: 200, naturalW: 1000, naturalH: 1000 };

    it('follows a downward drag so more of the top becomes visible', () => {
        const next = panCoverByPixels({ x: 50, y: 50 }, 0, 50, tall.frameW, tall.frameH, tall.naturalW, tall.naturalH);
        expect(next.y).toBe(25);
        expect(next.x).toBe(50);
    });

    it('leaves an axis alone when that side is already fully visible', () => {
        const next = panCoverByPixels({ x: 50, y: 50 }, 40, 0, tall.frameW, tall.frameH, tall.naturalW, tall.naturalH);
        expect(next.x).toBe(50);
    });

    it('stops at the edge of the photo', () => {
        const next = panCoverByPixels({ x: 50, y: 50 }, 0, -200, tall.frameW, tall.frameH, tall.naturalW, tall.naturalH);
        expect(next.y).toBe(100);
    });
});
