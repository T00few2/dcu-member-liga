import { describe, it, expect } from 'vitest';
import { catalogWorldSlug, resolveZwiftRoute, slugifyZwiftName } from '@/lib/zwiftRouteCatalog';

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

    it('maps Zwift map codes that omit spaces onto catalog world slugs', () => {
        expect(catalogWorldSlug('NEWYORK')).toBe('new-york');
        expect(catalogWorldSlug('MAKURIISLANDS')).toBe('makuri-islands');
        expect(catalogWorldSlug('CRITCITY')).toBe('crit-city');
        expect(catalogWorldSlug('NEW YORK')).toBe('new-york');
        expect(catalogWorldSlug('WATOPIA')).toBe('watopia');
        expect(catalogWorldSlug('PARIS')).toBe('paris');

        expect(resolveZwiftRoute('MAKURIISLANDS', 'Neon Shore Loop')?.id).toBe(3600776267);
        expect(resolveZwiftRoute('NEWYORK', 'No Sleep Till Brooklyn')?.id).toBe(104170948);
        expect(resolveZwiftRoute('NEWYORK', 'Stay Puft Pursuit')?.id).toBe(3079921742);
        expect(resolveZwiftRoute('CRITCITY', 'Downtown Dolphin')?.id).toBe(947394567);
        expect(resolveZwiftRoute('Makuri Islands', 'Neon Shore Loop')?.world).toBe('makuri-islands');
        expect(resolveZwiftRoute('WATOPIA', 'Itza Party')?.id).toBe(4131664304);
        expect(resolveZwiftRoute('NOTAWORLD', 'Tempus Fugit')).toBeNull();
    });
});
