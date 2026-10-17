import { describe, expect, it } from 'vitest';
import { buildRaceAnnouncementHtml, formatRaceWhen, raceAnnouncementIntroHtml } from '@/lib/campaignEmail';

describe('raceAnnouncementIntroHtml', () => {
    it('names the weekday, date, time, route, and world', () => {
        const html = raceAnnouncementIntroHtml({
            date: '2026-10-18T17:00:00.000Z',
            routeName: 'Hilly Route',
            map: 'Watopia',
        });

        expect(html).toBe(
            '<p>På søndag d. 18. oktober køres næste afdeling i DCU E-Serien klokken 19.00 på Hilly Route i Watopia.</p><p>Er du allerede tilmeldt? Så er du klar. Ellers kan du stadig nå at melde dig.</p>',
        );
    });
});

describe('buildRaceAnnouncementHtml', () => {
    it('includes the greeting, the next race card, and a link to the front page', () => {
        const date = '2026-10-18T17:00:00.000Z';
        const html = buildRaceAnnouncementHtml({
            siteUrl: 'https://www.dansk-ecykling.dk/',
            introHtml: '<p>Husk at tilmelde jer.</p>',
            race: {
                name: 'Watopia Classic',
                date,
                map: 'Watopia',
                routeName: 'Hilly Route',
                laps: 3,
                totalDistance: 42.4,
                totalElevation: 840,
            },
        });

        expect(html).toContain('Hej $[FNAME|]$');
        expect(html).toContain('Watopia Classic');
        expect(html).toContain(formatRaceWhen(date));
        expect(html).toContain('Watopia');
        expect(html).toContain('Hilly Route');
        expect(html).toContain('Distance');
        expect(html).toContain('42,4 km');
        expect(html).toContain('Højdemeter');
        expect(html).toContain('840 m');
        expect(html).toContain('Omgange');
        expect(html).toContain('>3<');
        expect(html).toContain('Husk at tilmelde jer.');
        expect(html).toContain('https://www.dansk-ecykling.dk/');
        expect(html).toContain('Gå til løbet');
        expect(html).not.toContain('/schedule');
        expect(html).toContain('prefers-color-scheme: dark');
        expect(html).toContain('https://www.dansk-ecykling.dk/brand/dcu-e-serien-logo-white.png');
        expect(html).toContain('Venlig hilsen');
        expect(html).not.toContain('https://www.dansk-ecykling.dk//');
    });

    it('includes the route profile and sprint list', () => {
        const html = buildRaceAnnouncementHtml({
            siteUrl: 'https://www.dansk-ecykling.dk',
            introHtml: '',
            race: {
                name: 'Watopia Classic',
                date: '2026-10-18T17:00:00.000Z',
                sprints: [{ id: 'sprint-1', name: 'Fuego Flats', count: 1, lap: 1 }],
            },
            profile: {
                distance: [0, 1000, 2000],
                altitude: [10, 40, 20],
                leadInDistance: 0.4,
                profileSegments: [{ name: 'Fuego Flats', type: 'sprint', fromKm: 1, toKm: 1.4 }],
            },
        });

        expect(html).toContain('Ruteprofil');
        expect(html).toContain('Pointsprint');
        expect(html).toContain('Fuego Flats');
        expect(html).toContain('Fra km');
        expect(html).toContain('1.4');
        expect(html).toContain('Gå til løbet');
    });

    it('escapes race names', () => {
        const html = buildRaceAnnouncementHtml({
            siteUrl: 'https://www.dansk-ecykling.dk',
            introHtml: '',
            race: { name: '<script>', date: 'not-a-date' },
        });

        expect(html).toContain('&lt;script&gt;');
        expect(html).toContain('Dato ukendt');
        expect(html).not.toContain('<script>');
    });
});
