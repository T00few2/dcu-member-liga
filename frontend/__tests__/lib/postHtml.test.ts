import { describe, expect, it } from 'vitest';
import { postExcerpt, postPlainText, renderPostHtml, safeUrl } from '@/lib/postHtml';

const doc = {
    type: 'doc',
    content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Ruten' }] },
        {
            type: 'paragraph',
            content: [
                { type: 'text', text: 'Kør ' },
                { type: 'text', text: 'hårdt', marks: [{ type: 'bold' }, { type: 'italic' }] },
                { type: 'hardBreak' },
                { type: 'text', text: 'Se ', marks: [] },
                { type: 'text', text: 'kalenderen', marks: [{ type: 'link', attrs: { href: 'https://www.dansk-ecykling.dk/schedule', target: '_blank' } }] },
            ],
        },
        {
            type: 'orderedList',
            attrs: { start: 3 },
            content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'KOM' }] }] }],
        },
        { type: 'image', attrs: { src: 'https://example.com/a.png', alt: 'Kort', width: null } },
        { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Citat', marks: [{ type: 'underline' }] }] }] },
    ],
};

describe('renderPostHtml', () => {
    it('renders the editor nodes and marks as TipTap does', () => {
        expect(renderPostHtml(doc)).toBe(
            '<h2>Ruten</h2>'
            + '<p>Kør <strong><em>hårdt</em></strong><br>Se <a href="https://www.dansk-ecykling.dk/schedule" target="_blank" rel="noopener noreferrer nofollow">kalenderen</a></p>'
            + '<ol start="3"><li><p>KOM</p></li></ol>'
            + '<img src="https://example.com/a.png" alt="Kort" loading="lazy">'
            + '<blockquote><p><u>Citat</u></p></blockquote>',
        );
    });

    it('nests marks in the editor order and keeps a shared mark as one element', () => {
        const link = { type: 'link', attrs: { href: 'https://a.dk' } };
        expect(renderPostHtml({
            type: 'paragraph',
            content: [
                { type: 'text', text: 'Læs ', marks: [{ type: 'underline' }, link] },
                { type: 'text', text: 'mere', marks: [link, { type: 'bold' }, { type: 'underline' }] },
                { type: 'hardBreak', marks: [link] },
                { type: 'text', text: 'her', marks: [link] },
                { type: 'text', text: ' nu' },
            ],
        })).toBe('<p><a href="https://a.dk" target="_blank" rel="noopener noreferrer nofollow"><u>Læs </u><strong><u>mere</u></strong><br>her</a> nu</p>');
    });

    it('gives empty blocks and a trailing line break an extra <br>, as the editor does', () => {
        expect(renderPostHtml({ type: 'paragraph' })).toBe('<p><br></p>');
        expect(renderPostHtml({ type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }] })).toBe('<p>a<br><br></p>');
        expect(renderPostHtml({ type: 'heading', attrs: { level: 3 }, content: [] })).toBe('<h3><br></h3>');
    });

    it('escapes text and attributes', () => {
        const html = renderPostHtml({
            type: 'doc',
            content: [
                { type: 'paragraph', content: [{ type: 'text', text: '<script>alert("x")</script> & co' }] },
                { type: 'image', attrs: { src: 'https://e.com/a.png" onerror="x', alt: '"><b>' } },
            ],
        });
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co');
        expect(html).toContain('src="https://e.com/a.png&quot; onerror=&quot;x"');
        expect(html).toContain('alt="&quot;&gt;&lt;b&gt;"');
    });

    it('drops unsafe links and images but keeps their text', () => {
        const html = renderPostHtml({
            type: 'doc',
            content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'klik', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] },
                { type: 'image', attrs: { src: 'data:image/png;base64,AAAA' } },
            ],
        });
        expect(html).toBe('<p>klik</p>');
    });

    it('keeps the text of node types it does not know', () => {
        expect(renderPostHtml({ type: 'doc', content: [{ type: 'callout', content: [{ type: 'text', text: 'Bemærk' }] }] })).toBe('Bemærk');
        expect(renderPostHtml(null)).toBe('');
    });
});

describe('safeUrl', () => {
    it('allows http(s), mailto and site paths only', () => {
        expect(safeUrl('https://a.dk')).toBe('https://a.dk');
        expect(safeUrl('/nyheder')).toBe('/nyheder');
        expect(safeUrl('mailto:a@b.dk')).toBe('mailto:a@b.dk');
        expect(safeUrl('mailto:a@b.dk', { allowMailto: false })).toBeNull();
        expect(safeUrl('//evil.com')).toBeNull();
        expect(safeUrl(' JavaScript:alert(1)')).toBeNull();
    });
});

describe('postPlainText and postExcerpt', () => {
    it('joins blocks with spaces', () => {
        expect(postPlainText(doc)).toBe('Ruten Kør hårdt Se kalenderen KOM Citat');
    });

    it('cuts the excerpt at a word', () => {
        expect(postExcerpt(doc, 14)).toBe('Ruten Kør…');
        expect(postExcerpt(doc, 500)).toBe('Ruten Kør hårdt Se kalenderen KOM Citat');
    });
});
