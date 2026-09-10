import { describe, it, expect } from 'vitest';
import {
    authorSelectLabel,
    defaultPosterAuthor,
    filterAuthorParticipants,
    isPosterAuthor,
    parseAuthorParticipants,
    participantAuthorValue,
} from '@/lib/postAuthorOptions';

describe('defaultPosterAuthor', () => {
    it('uses the signed-in profile name and zwift id when present', () => {
        expect(defaultPosterAuthor({
            profileName: 'Anna Hansen',
            profileZwiftId: '111',
            authDisplayName: 'Admin Display',
            authEmail: 'admin@example.com',
        })).toEqual({
            selfName: 'Anna Hansen',
            value: { authorName: 'Anna Hansen', authorZwiftId: '111' },
        });
    });

    it('falls back to auth display name when there is no profile', () => {
        expect(defaultPosterAuthor({
            authDisplayName: 'Bo Nielsen',
            authEmail: 'bo@example.com',
        })).toEqual({
            selfName: 'Bo Nielsen',
            value: { authorName: 'Bo Nielsen', authorZwiftId: null },
        });
    });

    it('falls back to email then Admin', () => {
        expect(defaultPosterAuthor({ authEmail: 'bo@example.com' }).selfName).toBe('bo@example.com');
        expect(defaultPosterAuthor({}).selfName).toBe('Admin');
    });
});

describe('isPosterAuthor', () => {
    it('matches the poster by zwift id when the poster is a participant', () => {
        const poster = { authorName: 'Anna Hansen', authorZwiftId: '111' };
        expect(isPosterAuthor(poster, poster)).toBe(true);
        expect(isPosterAuthor({ authorName: 'Other', authorZwiftId: '222' }, poster)).toBe(false);
    });

    it('matches by name when the poster has no zwift id', () => {
        const poster = { authorName: 'Bo Nielsen', authorZwiftId: null };
        expect(isPosterAuthor(poster, poster)).toBe(true);
        expect(isPosterAuthor({ authorName: 'Bo Nielsen', authorZwiftId: '222' }, poster)).toBe(false);
    });
});

describe('parseAuthorParticipants / filterAuthorParticipants', () => {
    const riders = parseAuthorParticipants([
        { name: 'Bo Nielsen', zwiftId: '222', club: 'Club B' },
        { name: 'Anna Hansen', zwiftId: '111', club: 'Club A' },
        { name: '', zwiftId: 'skip' },
        { name: 'Dup', zwiftId: '111' },
    ]);

    it('keeps unique riders with name and zwift id', () => {
        expect(riders).toEqual([
            { name: 'Bo Nielsen', zwiftId: '222', club: 'Club B' },
            { name: 'Anna Hansen', zwiftId: '111', club: 'Club A' },
        ]);
    });

    it('filters by name, zwift id, or club and sorts in Danish', () => {
        expect(filterAuthorParticipants(riders, '').map(r => r.name)).toEqual(['Anna Hansen', 'Bo Nielsen']);
        expect(filterAuthorParticipants(riders, 'hans').map(r => r.zwiftId)).toEqual(['111']);
        expect(filterAuthorParticipants(riders, '222').map(r => r.name)).toEqual(['Bo Nielsen']);
        expect(filterAuthorParticipants(riders, 'club a').map(r => r.zwiftId)).toEqual(['111']);
    });
});

describe('authorSelectLabel', () => {
    it('shows the selected byline name', () => {
        const poster = { authorName: 'Anna Hansen', authorZwiftId: '111' };
        expect(authorSelectLabel(poster, poster)).toBe('Anna Hansen');
        expect(authorSelectLabel(participantAuthorValue({ name: 'Bo Nielsen', zwiftId: '222' }), poster)).toBe('Bo Nielsen');
    });
});
