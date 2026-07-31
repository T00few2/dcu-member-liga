import { describe, it, expect } from 'vitest';
import { routes as zwiftRoutes } from 'zwift-data';
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

    it('fills Paris segmentsOnRoute when zwift-data list is empty', () => {
        const boucle = resolveZwiftRoute('PARIS', 'La Boucle');
        expect(boucle?.segmentsOnRoute?.length).toBeGreaterThan(0);
        expect(boucle?.segmentsOnRoute?.map((s) => s.segment)).toEqual([
            'lutece-sprint',
            'monceau-sprint',
            'montmartre-kom',
            'tchou-tchou-sprint',
        ]);

        const crepe = resolveZwiftRoute('PARIS', 'Crêpe Escape');
        expect(crepe?.segmentsOnRoute?.length).toBe(4);
    });

    it('does not replace non-empty zwift-data segmentsOnRoute', () => {
        const catalog = zwiftRoutes.find((r) => r.world === 'paris' && r.slug === 'champs-elysees');
        expect(catalog?.segmentsOnRoute?.length).toBeGreaterThan(0);

        const champs = resolveZwiftRoute('PARIS', 'Champs-Élysées');
        expect(champs?.segmentsOnRoute).toEqual(catalog?.segmentsOnRoute);
    });
});
