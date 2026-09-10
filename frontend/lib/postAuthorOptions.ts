export interface PostAuthorParticipant {
    name: string;
    zwiftId: string;
    club?: string | null;
}

export interface PostAuthorValue {
    authorName: string;
    authorZwiftId: string | null;
}

export function participantAuthorValue(participant: PostAuthorParticipant): PostAuthorValue {
    return { authorName: participant.name, authorZwiftId: participant.zwiftId };
}

export function defaultPosterAuthor(input: {
    profileName?: string | null;
    profileZwiftId?: string | null;
    authDisplayName?: string | null;
    authEmail?: string | null;
}): { selfName: string; value: PostAuthorValue } {
    const selfName = (
        input.profileName?.trim()
        || input.authDisplayName?.trim()
        || input.authEmail?.trim()
        || 'Admin'
    );
    const zwiftId = input.profileZwiftId?.trim() || null;
    return {
        selfName,
        value: { authorName: selfName, authorZwiftId: zwiftId },
    };
}

export function isPosterAuthor(value: PostAuthorValue, poster: PostAuthorValue): boolean {
    if (poster.authorZwiftId) {
        return value.authorZwiftId === poster.authorZwiftId;
    }
    return value.authorZwiftId == null && value.authorName === poster.authorName;
}

export function parseAuthorParticipants(raw: unknown): PostAuthorParticipant[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: PostAuthorParticipant[] = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const o = item as Record<string, unknown>;
        if (typeof o.name !== 'string' || !o.name.trim()) continue;
        if (typeof o.zwiftId !== 'string' || !o.zwiftId.trim()) continue;
        if (seen.has(o.zwiftId)) continue;
        seen.add(o.zwiftId);
        out.push({
            name: o.name,
            zwiftId: o.zwiftId,
            club: typeof o.club === 'string' ? o.club : null,
        });
    }
    return out;
}

export function filterAuthorParticipants(
    participants: PostAuthorParticipant[],
    query: string,
): PostAuthorParticipant[] {
    const q = query.trim().toLowerCase();
    const filtered = !q
        ? participants
        : participants.filter(p =>
            p.name.toLowerCase().includes(q)
            || p.zwiftId.toLowerCase().includes(q)
            || (p.club ?? '').toLowerCase().includes(q),
        );
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name, 'da'));
}

export function authorSelectLabel(value: PostAuthorValue, poster: PostAuthorValue): string {
    return value.authorName || poster.authorName;
}
