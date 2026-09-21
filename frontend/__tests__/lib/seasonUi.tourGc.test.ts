import { describe, expect, it } from 'vitest';
import { tourGcCountingSentence } from '@/lib/seasonUi';

function stages(n: number) {
    return Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}` }));
}

describe('tourGcCountingSentence', () => {
    it('states best-X of Y when some stages are dropped', () => {
        expect(tourGcCountingSentence({
            name: 'DCU Ligaen',
            bestRacesCount: 6,
            stages: stages(7),
        })).toBe('DCU Ligaen: De bedste 6 af 7 etaper tæller til Tour-GC.');
    });

    it('states that every stage counts when best-X covers the tour', () => {
        expect(tourGcCountingSentence({
            name: 'DCU Ligaen',
            bestRacesCount: 7,
            stages: stages(7),
        })).toBe('DCU Ligaen: Alle 7 etaper tæller til Tour-GC.');
    });

    it('uses singular copy for a single counting stage', () => {
        expect(tourGcCountingSentence({
            name: 'Mini-tour',
            bestRacesCount: 1,
            stages: stages(4),
        })).toBe('Mini-tour: Den bedste etape af 4 tæller til Tour-GC.');
    });

    it('can omit the event name', () => {
        expect(tourGcCountingSentence({
            name: 'DCU Ligaen',
            bestRacesCount: 6,
            stages: stages(7),
        }, { includeName: false })).toBe('De bedste 6 af 7 etaper tæller til Tour-GC.');
    });

    it('falls back to best-X when stage list is empty', () => {
        expect(tourGcCountingSentence({
            name: 'DCU Ligaen',
            bestRacesCount: 6,
            stages: [],
        })).toBe('DCU Ligaen: De bedste 6 etaper tæller til Tour-GC.');
    });
});
