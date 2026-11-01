import { describe, expect, it } from 'vitest';
import { buildNewsLlmsSection, buildNewsRss } from '@/lib/newsFeed';
import { postFromFields } from '@/lib/postsServer';

const post = postFromFields('p1', {
    title: 'Race Preview: DZR løbet & co',
    slug: 'race-preview-dzr-loebet',
    status: 'published',
    authorName: 'Christian',
    tags: ['Preview'],
    publishedAt: '2026-10-15T20:13:29.986Z',
    updatedAt: '2026-10-16T08:00:00.000Z',
    body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Torsdag køres DZR løbet. ]]> ok' }] }] },
});

describe('buildNewsRss', () => {
    it('lists each post with link, date, summary and full HTML', () => {
        const xml = buildNewsRss([post], 'https://www.dansk-ecykling.dk/');
        expect(xml).toContain('<title>Race Preview: DZR løbet &amp; co</title>');
        expect(xml).toContain('<link>https://www.dansk-ecykling.dk/nyheder/race-preview-dzr-loebet</link>');
        expect(xml).toContain('<pubDate>Thu, 15 Oct 2026 20:13:29 GMT</pubDate>');
        expect(xml).toContain('<dc:creator>Christian</dc:creator>');
        expect(xml).toContain('<category>Preview</category>');
        expect(xml).toContain('<description>Torsdag køres DZR løbet. ]]&gt; ok</description>');
        // Text is escaped, so a "]]>" in a post cannot end the CDATA section early.
        expect(xml).toContain('<content:encoded><![CDATA[<p>Torsdag køres DZR løbet. ]]&gt; ok</p>]]></content:encoded>');
    });

    it('is a valid empty feed without posts', () => {
        const xml = buildNewsRss([], 'https://www.dansk-ecykling.dk');
        expect(xml).toContain('<channel>');
        expect(xml).not.toContain('<item>');
    });
});

describe('buildNewsLlmsSection', () => {
    it('includes the post text, not only a short teaser', () => {
        const text = buildNewsLlmsSection([post], 'https://www.dansk-ecykling.dk');
        expect(text).toContain('## Nyheder');
        expect(text).toContain('### Race Preview: DZR løbet & co');
        expect(text).toContain('2026-10-15 — https://www.dansk-ecykling.dk/nyheder/race-preview-dzr-loebet');
        expect(text).toContain('Torsdag køres DZR løbet. ]]> ok');
    });
});
