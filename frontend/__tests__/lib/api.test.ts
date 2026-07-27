import { describe, it, expect } from 'vitest';
import { getZwiftInsiderUrl } from '@/lib/api';

describe('getZwiftInsiderUrl', () => {
    it('slugifies a simple route name', () => {
        expect(getZwiftInsiderUrl('Bon Voyage')).toBe('https://zwiftinsider.com/route/bon-voyage/');
    });

    it('transliterates accented characters instead of dropping them', () => {
        expect(getZwiftInsiderUrl('Crêpe Escape')).toBe('https://zwiftinsider.com/route/crepe-escape/');
    });

    it('strips apostrophes without leaving gaps', () => {
        expect(getZwiftInsiderUrl("Dos d'Âne")).toBe('https://zwiftinsider.com/route/dos-dane/');
    });

    it('returns "#" for an empty route name', () => {
        expect(getZwiftInsiderUrl('')).toBe('#');
    });
});
