import { describe, expect, it } from 'vitest';
import { buildRaceAnnouncementHtml, formatRaceWhen } from '@/lib/campaignEmail';

describe('buildRaceAnnouncementHtml', () => {
    it('includes the greeting, race details, and schedule link', () => {
        const date = '2026-10-18T17:00:00.000Z';
        const html = buildRaceAnnouncementHtml({
            siteUrl: 'https://www.dansk-ecykling.dk/',
            introHtml: '<p>Husk at tilmelde jer.</p>',
            races: [{
                name: 'Watopia Classic',
                date,
                routeName: 'Hilly Route',
                laps: 3,
                totalDistance: 42.4,
            }],
        });

        expect(html).toContain('Hej $[FNAME|]$');
        expect(html).toContain('Watopia Classic');
        expect(html).toContain(formatRaceWhen(date));
        expect(html).toContain('Hilly Route');
        expect(html).toContain('3 omgange');
        expect(html).toContain('42,4 km');
        expect(html).toContain('Husk at tilmelde jer.');
        expect(html).toContain('https://www.dansk-ecykling.dk/schedule');
        expect(html).toContain('https://www.dansk-ecykling.dk/brand/dcu-e-serien-logo-white.png');
        expect(html).toContain('Venlig hilsen');
        expect(html).not.toContain('https://www.dansk-ecykling.dk//');
    });

    it('escapes race names', () => {
        const html = buildRaceAnnouncementHtml({
            siteUrl: 'https://www.dansk-ecykling.dk',
            introHtml: '',
            races: [{ name: '<script>', date: 'not-a-date' }],
        });

        expect(html).toContain('&lt;script&gt;');
        expect(html).toContain('Dato ukendt');
        expect(html).not.toContain('<script>');
    });
});
