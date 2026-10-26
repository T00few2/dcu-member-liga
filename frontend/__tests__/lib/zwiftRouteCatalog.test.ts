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

    it('resolves routes whose display name no longer matches the catalog slug', () => {
        const richmond = resolveZwiftRoute('RICHMOND', 'Richmond UCI Worlds');
        expect(richmond?.id).toBe(2196019512);
        expect(richmond?.slug).toBe('2015-uci-worlds-course');
        expect(richmond?.stravaSegmentId).toBe(12128718);
    });

    it('uses upstream Paris segmentsOnRoute from zwift-data', () => {
        const boucle = resolveZwiftRoute('PARIS', 'La Boucle');
        expect(boucle?.segmentsOnRoute?.map((s) => s.segment)).toEqual([
            'lutece-sprint',
            'monceau-sprint',
            'montmartre-kom',
            'tchou-tchou-sprint',
        ]);
    });
});
