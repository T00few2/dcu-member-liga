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

    it('marks the race sprints on the profile and rules the whole sprint row', () => {
        const html = buildRaceAnnouncementHtml({
            siteUrl: 'https://www.dansk-ecykling.dk',
            introHtml: '',
            race: {
                name: 'Watopia Classic',
                date: '2026-10-18T17:00:00.000Z',
                laps: 1,
                sprints: [{ id: 'sprint-1', name: 'Fuego Flats Reverse', count: 1, lap: 1, direction: 'reverse' }],
            },
            profile: {
                distance: [0, 1000, 2000],
                altitude: [10, 40, 20],
                leadInDistance: 0.4,
                profileSegments: [
                    { name: 'Finish Arch', type: 'sprint', fromKm: 1.9, toKm: 2 },
                    { name: 'Fuego Flats', type: 'segment', fromKm: 1, toKm: 1.4, direction: 'reverse' },
                ],
            },
        });

        expect(html).toContain('Fuego Flats Reverse');
        expect(html).not.toContain('Reverse Reverse');
        expect(html).toContain('1.4');
        expect(html).toContain('1.8');
        expect(html.match(/★/g)).toHaveLength(2);
        const sprintBars = html.match(/class="elev-sprint"/g) ?? [];
        expect(sprintBars.length).toBeGreaterThan(0);
        expect(sprintBars.length).toBeLessThan(25);
        const kmCell = html.slice(html.indexOf('>1.4<'));
        expect(html.slice(html.lastIndexOf('<td', html.indexOf('>1.4<')), html.indexOf('>1.4<'))).toContain('border-bottom:1px solid #e9e9e9');
        expect(kmCell).toContain('border-bottom:1px solid #e9e9e9');
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
