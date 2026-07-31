import { describe, it, expect } from 'vitest';
import { resolveZwiftRoute, slugifyZwiftName } from '@/lib/zwiftRouteCatalog';

describe('slugifyZwiftName', () => {
    it('strips diacritics so Paris names match zwift-data slugs', () => {
        expect(slugifyZwiftName('Crêpe Escape')).toBe('crepe-escape');
        expect(slugifyZwiftName('Champs-Élysées')).toBe('champs-elysees');
        expect(slugifyZwiftName('PARIS')).toBe('paris');
    });
});

describe('resolveZwiftRoute', () => {
    it('resolves Paris accented route names', () => {
        const match = resolveZwiftRoute('PARIS', 'Crêpe Escape');
        expect(match?.slug).toBe('crepe-escape');
        expect(match?.stravaSegmentId).toBeTruthy();
    });

    it('applies local Strava overrides for routes missing in zwift-data', () => {
        const queens = resolveZwiftRoute('YORKSHIRE', "Queen's Highway After Party");
        expect(queens?.stravaSegmentId).toBe(39270897);

        const hudson = resolveZwiftRoute('NEW YORK', 'Hudson Hustle');
        expect(hudson?.stravaSegmentId).toBe(40654556);
    });
});
