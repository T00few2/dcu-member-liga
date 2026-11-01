import { describe, expect, it } from 'vitest';
import { decodeFirestoreFields, postFromFields } from '@/lib/postsServer';

describe('decodeFirestoreFields', () => {
    it('decodes the REST value types a post uses', () => {
        const data = decodeFirestoreFields({
            title: { stringValue: 'Race Preview' },
            commentCount: { integerValue: '3' },
            coverPositionY: { doubleValue: 20.5 },
            publishedAt: { timestampValue: '2026-10-15T20:13:29.986Z' },
            authorZwiftId: { nullValue: null },
            tags: { arrayValue: { values: [{ stringValue: 'Preview' }] } },
            emptyTags: { arrayValue: {} },
            body: {
                mapValue: {
                    fields: {
                        type: { stringValue: 'doc' },
                        content: { arrayValue: { values: [{ mapValue: { fields: { type: { stringValue: 'paragraph' } } } }] } },
                    },
                },
            },
        });
        expect(data).toEqual({
            title: 'Race Preview',
            commentCount: 3,
            coverPositionY: 20.5,
            publishedAt: '2026-10-15T20:13:29.986Z',
            authorZwiftId: null,
            tags: ['Preview'],
            emptyTags: [],
            body: { type: 'doc', content: [{ type: 'paragraph' }] },
        });
    });
});

describe('postFromFields', () => {
    it('applies the same defaults as the browser loader', () => {
        const post = postFromFields('p1', { title: 'T', slug: 't', status: 'published', publishedAt: '2026-10-15T20:13:29.986Z' });
        expect(post).toMatchObject({
            id: 'p1',
            title: 'T',
            slug: 't',
            status: 'published',
            coverImageUrl: null,
            coverPositionX: 50,
            coverPositionY: 50,
            tags: [],
            authorZwiftId: null,
            commentCount: 0,
            publishedAt: '2026-10-15T20:13:29.986Z',
            body: { type: 'doc', content: [] },
        });
        expect(postFromFields('p2', { status: 'draft' }).status).toBe('draft');
    });
});
