import type { Post } from '@/types/posts';
import { escapeHtml, postExcerpt, renderPostHtml } from './postHtml';

/** RSS 2.0 for /nyheder/rss.xml: title, link, date, summary and the full post as HTML. */
export function buildNewsRss(posts: Post[], siteUrl: string): string {
    const site = siteUrl.replace(/\/$/, '');
    const items = posts.map((post) => {
        const link = `${site}/nyheder/${encodeURIComponent(post.slug)}`;
        const date = post.publishedAt ? new Date(post.publishedAt) : null;
        const html = renderPostHtml(post.body).replace(/]]>/g, ']]]]><![CDATA[>');
        return [
            '    <item>',
            `      <title>${escapeHtml(post.title)}</title>`,
            `      <link>${escapeHtml(link)}</link>`,
            `      <guid isPermaLink="true">${escapeHtml(link)}</guid>`,
            date && !Number.isNaN(date.getTime()) ? `      <pubDate>${date.toUTCString()}</pubDate>` : '',
            post.authorName ? `      <dc:creator>${escapeHtml(post.authorName)}</dc:creator>` : '',
            ...post.tags.map((tag) => `      <category>${escapeHtml(tag)}</category>`),
            `      <description>${escapeHtml(postExcerpt(post.body, 300))}</description>`,
            `      <content:encoded><![CDATA[${html}]]></content:encoded>`,
            '    </item>',
        ].filter(Boolean).join('\n');
    });
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">',
        '  <channel>',
        '    <title>DCU E-serien – Nyheder</title>',
        `    <link>${escapeHtml(`${site}/nyheder`)}</link>`,
        `    <atom:link href="${escapeHtml(`${site}/nyheder/rss.xml`)}" rel="self" type="application/rss+xml"/>`,
        '    <description>Race previews, analyser og nyt fra ligaen.</description>',
        '    <language>da</language>',
        ...items,
        '  </channel>',
        '</rss>',
        '',
    ].join('\n');
}

/** The "Nyheder" section appended to /llms.txt: the newest posts with a link and a summary. */
export function buildNewsLlmsSection(posts: Post[], siteUrl: string, max = 20): string {
    const site = siteUrl.replace(/\/$/, '');
    const lines = [
        '## Nyheder',
        '',
        `Race previews, analyser og nyt fra ligaen. Alle indlæg: ${site}/nyheder (RSS: ${site}/nyheder/rss.xml)`,
        '',
    ];
    for (const post of posts.slice(0, max)) {
        const date = post.publishedAt ? post.publishedAt.slice(0, 10) : '';
        const summary = postExcerpt(post.body, 160);
        lines.push(`- [${post.title}](${site}/nyheder/${encodeURIComponent(post.slug)})${date ? ` (${date})` : ''}${summary ? `: ${summary}` : ''}`);
    }
    return lines.join('\n');
}
