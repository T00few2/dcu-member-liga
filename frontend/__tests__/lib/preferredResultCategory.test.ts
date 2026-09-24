import { describe, expect, it } from 'vitest';
import { preferredResultCategory } from '@/lib/preferredResultCategory';

describe('preferredResultCategory', () => {
    it('uses the current division when the rider appears in more than one', () => {
        const results = {
            A: [{ zwiftId: '1' }],
            B: [{ zwiftId: '1' }],
        };
        expect(preferredResultCategory(results, '1', 'B')).toBe('B');
    });

    it('falls back to the first result division when the current one has no row', () => {
        const results = { A: [{ zwiftId: '1' }] };
        expect(preferredResultCategory(results, '1', 'C')).toBe('A');
    });
});
