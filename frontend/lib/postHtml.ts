/**
 * Render a news post body (TipTap JSON) to HTML and plain text on the server.
 *
 * The page used to draw the body in the browser with TipTap, so search engines, link previews and
 * bots saw no text. This covers the nodes and marks of the blog editor (StarterKit + Image) and
 * produces the same tags TipTap does, so the `.blog-content` styles apply unchanged. Every text and
 * attribute is escaped, and only http(s), mailto and site-relative links are kept.
 */

export interface PostNode {
    type?: string;
    text?: string;
    attrs?: Record<string, unknown>;
    marks?: { type?: string; attrs?: Record<string, unknown> }[];
    content?: PostNode[];
}

export function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function safeUrl(value: unknown, { allowMailto = true } = {}): string | null {
    const url = String(value ?? '').trim();
    if (!url) return null;
    if (url.startsWith('/') && !url.startsWith('//')) return url;
    if (/^https?:\/\//i.test(url)) return url;
    if (allowMailto && /^mailto:/i.test(url)) return url;
    return null;
}

function attr(name: string, value: unknown): string {
    if (value === null || value === undefined || value === '') return '';
    return ` ${name}="${escapeHtml(value)}"`;
}

type Mark = NonNullable<PostNode['marks']>[number];

// The editor schema's mark order (Link has a higher priority than StarterKit's marks). TipTap
// nests marks in this order, outermost first, whatever order they are stored in.
const MARK_ORDER = ['link', 'bold', 'code', 'italic', 'strike', 'underline'];

function markKey(mark: Mark): string {
    return mark.type === 'link' ? `link:${String(mark.attrs?.href ?? '')}` : String(mark.type);
}

/** The marks that render, outermost first. Unknown marks and unsafe links are dropped. */
function renderedMarks(marks: PostNode['marks']): Mark[] {
    return (marks ?? [])
        .filter((mark) => MARK_ORDER.includes(String(mark?.type)) && (mark.type !== 'link' || safeUrl(mark.attrs?.href)))
        .sort((a, b) => MARK_ORDER.indexOf(String(a.type)) - MARK_ORDER.indexOf(String(b.type)));
}

function openMark(mark: Mark): string {
    switch (mark.type) {
        case 'link': {
            const href = safeUrl(mark.attrs?.href)!;
            const external = /^https?:\/\//i.test(href);
            return `<a href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noopener noreferrer nofollow"' : ''}>`;
        }
        case 'bold': return '<strong>';
        case 'italic': return '<em>';
        case 'underline': return '<u>';
        case 'strike': return '<s>';
        case 'code': return '<code>';
        default: return '';
    }
}

const CLOSE_TAG: Record<string, string> = { link: '</a>', bold: '</strong>', italic: '</em>', underline: '</u>', strike: '</s>', code: '</code>' };

/**
 * Inline content as ProseMirror serialises it: a mark that continues across neighbouring text
 * stays one element, so "**bold *and italic***" is <strong>bold <em>and italic</em></strong>.
 */
function renderInline(children: PostNode[]): string {
    let out = '';
    let open: Mark[] = [];
    for (const child of children) {
        // Inline nodes carry marks too (a line break typed inside bold text stays bold).
        const marks = renderedMarks(child?.marks);
        let keep = 0;
        while (keep < open.length && keep < marks.length && markKey(open[keep]) === markKey(marks[keep])) keep++;
        for (let i = open.length - 1; i >= keep; i--) out += CLOSE_TAG[String(open[i].type)] ?? '';
        for (let i = keep; i < marks.length; i++) out += openMark(marks[i]);
        open = marks;
        out += child?.type === 'text' ? escapeHtml(child.text) : renderNode(child);
    }
    for (let i = open.length - 1; i >= 0; i--) out += CLOSE_TAG[String(open[i].type)] ?? '';
    return out;
}

function renderChildren(node: PostNode): string {
    return (node.content ?? []).map(renderNode).join('');
}

/**
 * A text block's content. Like the editor, an empty block or one ending in a line break gets an
 * extra <br>, so it keeps its height on the page.
 */
function renderTextblock(node: PostNode): string {
    const children = node.content ?? [];
    const last = children[children.length - 1];
    return renderInline(children) + (!last || last.type === 'hardBreak' ? '<br>' : '');
}

function renderNode(node: PostNode): string {
    if (!node || typeof node !== 'object') return '';
    switch (node.type) {
        case 'text':
            return renderInline([node]);
        case 'paragraph':
            return `<p>${renderTextblock(node)}</p>`;
        case 'heading': {
            const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 2));
            return `<h${level}>${renderTextblock(node)}</h${level}>`;
        }
        case 'bulletList':
            return `<ul>${renderChildren(node)}</ul>`;
        case 'orderedList': {
            const start = Number(node.attrs?.start);
            return `<ol${Number.isFinite(start) && start !== 1 ? attr('start', start) : ''}>${renderChildren(node)}</ol>`;
        }
        case 'listItem':
            return `<li>${renderChildren(node)}</li>`;
        case 'blockquote':
            return `<blockquote>${renderChildren(node)}</blockquote>`;
        case 'codeBlock':
            return `<pre><code>${renderInline(node.content ?? [])}</code></pre>`;
        case 'hardBreak':
            return '<br>';
        case 'horizontalRule':
            return '<hr>';
        case 'image': {
            const src = safeUrl(node.attrs?.src, { allowMailto: false });
            if (!src) return '';
            return `<img src="${escapeHtml(src)}"${attr('alt', node.attrs?.alt)}${attr('title', node.attrs?.title)}${attr('width', node.attrs?.width)}${attr('height', node.attrs?.height)} loading="lazy">`;
        }
        default:
            // doc, and anything the editor adds later: keep the text rather than drop it.
            return renderChildren(node);
    }
}

export function renderPostHtml(body: PostNode | null | undefined): string {
    return body ? renderNode(body) : '';
}

const BLOCK_TYPES = new Set(['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock']);

function collectText(node: PostNode, out: string[]): void {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'text') {
        out.push(String(node.text ?? ''));
        return;
    }
    if (node.type === 'hardBreak') {
        out.push(' ');
        return;
    }
    for (const child of node.content ?? []) collectText(child, out);
    if (node.type && BLOCK_TYPES.has(node.type)) out.push(' ');
}

/** The body as one line of plain text. */
export function postPlainText(body: PostNode | null | undefined): string {
    if (!body) return '';
    const out: string[] = [];
    collectText(body, out);
    return out.join('').replace(/\s+/g, ' ').trim();
}

/** A short summary for link previews, RSS and the post list. */
export function postExcerpt(body: PostNode | null | undefined, maxChars = 200): string {
    const text = postPlainText(body);
    if (text.length <= maxChars) return text;
    const cut = text.slice(0, maxChars);
    const space = cut.lastIndexOf(' ');
    return `${(space > maxChars * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
