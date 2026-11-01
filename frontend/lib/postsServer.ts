/**
 * Published news posts for server rendering, the RSS feed, the sitemap and llms.txt.
 *
 * Reads Firestore over its REST API instead of the browser SDK, so nothing here initialises the
 * client app on the server. firestore.rules already lets anyone read a published post, which is
 * what the /nyheder pages did from the browser. Every loader returns null when Firestore cannot be
 * reached, so callers can fall back to the old in-browser loading instead of showing an error.
 */
import { cache } from 'react';
import type { Post } from '@/types/posts';
import { parseCoverPercent } from './coverPosition';

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '';
const TIMEOUT_MS = 8000;

type FirestoreValue = Record<string, unknown>;
type FieldFilter = { field: string; value: string };

/** Decode one Firestore REST value into plain JSON. Timestamps become ISO strings. */
export function decodeFirestoreValue(value: FirestoreValue | undefined): unknown {
    if (!value || typeof value !== 'object') return null;
    if ('stringValue' in value) return value.stringValue;
    if ('booleanValue' in value) return value.booleanValue;
    if ('integerValue' in value) return Number(value.integerValue);
    if ('doubleValue' in value) return Number(value.doubleValue);
    if ('timestampValue' in value) return value.timestampValue;
    if ('nullValue' in value) return null;
    if ('referenceValue' in value) return value.referenceValue;
    if ('arrayValue' in value) {
        const list = (value.arrayValue as { values?: FirestoreValue[] })?.values ?? [];
        return list.map(decodeFirestoreValue);
    }
    if ('mapValue' in value) {
        const fields = (value.mapValue as { fields?: Record<string, FirestoreValue> })?.fields ?? {};
        return decodeFirestoreFields(fields);
    }
    return null;
}

export function decodeFirestoreFields(fields: Record<string, FirestoreValue>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields ?? {})) out[key] = decodeFirestoreValue(value);
    return out;
}

function isoOrNull(value: unknown): string | null {
    return typeof value === 'string' && value ? value : null;
}

/** Same shape and defaults as normalizePost in lib/posts.ts. */
export function postFromFields(id: string, data: Record<string, unknown>): Post {
    return {
        id,
        title: String(data.title ?? ''),
        slug: String(data.slug ?? ''),
        coverImageUrl: data.coverImageUrl ? String(data.coverImageUrl) : null,
        coverPositionX: parseCoverPercent(data.coverPositionX),
        coverPositionY: parseCoverPercent(data.coverPositionY),
        body: (data.body as Post['body']) ?? { type: 'doc', content: [] },
        tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
        status: data.status === 'published' ? 'published' : 'draft',
        authorUid: String(data.authorUid ?? ''),
        authorName: String(data.authorName ?? ''),
        authorZwiftId: data.authorZwiftId ? String(data.authorZwiftId) : null,
        publishedAt: isoOrNull(data.publishedAt),
        createdAt: isoOrNull(data.createdAt) ?? new Date().toISOString(),
        updatedAt: isoOrNull(data.updatedAt) ?? new Date().toISOString(),
        commentCount: Number(data.commentCount ?? 0),
    };
}

function equalFilter({ field, value }: FieldFilter) {
    return { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } };
}

async function runPostQuery(filters: FieldFilter[], { limit, newestFirst }: { limit: number; newestFirst: boolean }): Promise<Post[] | null> {
    if (!PROJECT_ID) return null;
    const where = filters.length === 1
        ? equalFilter(filters[0])
        : { compositeFilter: { op: 'AND', filters: filters.map(equalFilter) } };
    const structuredQuery: Record<string, unknown> = { from: [{ collectionId: 'posts' }], where, limit };
    if (newestFirst) structuredQuery.orderBy = [{ field: { fieldPath: 'publishedAt' }, direction: 'DESCENDING' }];
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(PROJECT_ID)}/databases/(default)/documents:runQuery`;
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ structuredQuery }),
            cache: 'no-store',
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) {
            console.error('Loading news posts failed:', res.status);
            return null;
        }
        const rows = (await res.json()) as { document?: { name?: string; fields?: Record<string, FirestoreValue> } }[];
        if (!Array.isArray(rows)) return null;
        return rows
            .filter((row) => row.document?.fields)
            .map((row) => {
                const id = String(row.document!.name ?? '').split('/').pop() ?? '';
                return postFromFields(id, decodeFirestoreFields(row.document!.fields!));
            })
            .filter((post) => post.id && post.status === 'published');
    } catch (err) {
        console.error('Loading news posts failed:', err);
        return null;
    }
}

/** The newest published posts, newest first. null when Firestore could not be reached. */
export const loadPublishedPosts = cache(async (limit = 50): Promise<Post[] | null> => {
    return runPostQuery([{ field: 'status', value: 'published' }], { limit, newestFirst: true });
});

/** A published post, null when there is none with that slug, undefined when Firestore could not be reached. */
export const loadPublishedPostBySlug = cache(async (slug: string): Promise<Post | null | undefined> => {
    const rows = await runPostQuery(
        [{ field: 'slug', value: slug }, { field: 'status', value: 'published' }],
        { limit: 1, newestFirst: false },
    );
    if (rows === null) return undefined;
    return rows[0] ?? null;
});
