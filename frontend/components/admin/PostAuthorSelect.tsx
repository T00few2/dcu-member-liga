'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParticipantsQuery } from '@/hooks/queries';
import {
    authorSelectLabel,
    filterAuthorParticipants,
    isPosterAuthor,
    parseAuthorParticipants,
    participantAuthorValue,
    type PostAuthorValue,
} from '@/lib/postAuthorOptions';

interface PostAuthorSelectProps {
    poster: PostAuthorValue;
    value: PostAuthorValue;
    onChange: (next: PostAuthorValue) => void;
}

export default function PostAuthorSelect({ poster, value, onChange }: PostAuthorSelectProps) {
    const participantsQuery = useParticipantsQuery();
    const participants = useMemo(
        () => parseAuthorParticipants(participantsQuery.data),
        [participantsQuery.data],
    );

    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const rootRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    const filtered = useMemo(() => {
        const list = filterAuthorParticipants(participants, query);
        if (!poster.authorZwiftId) return list;
        return list.filter(p => p.zwiftId !== poster.authorZwiftId);
    }, [participants, query, poster.authorZwiftId]);

    const q = query.trim().toLowerCase();
    const showPoster = !q || poster.authorName.toLowerCase().includes(q);
    const posterSelected = isPosterAuthor(value, poster);

    useEffect(() => {
        if (!open) return;
        searchRef.current?.focus();
        const onDoc = (e: MouseEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) {
                setOpen(false);
                setQuery('');
            }
        };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, [open]);

    const selectPoster = () => {
        onChange(poster);
        setOpen(false);
        setQuery('');
    };

    return (
        <div ref={rootRef} className="relative">
            <label className="block text-sm font-medium text-foreground mb-1" htmlFor="post-author-toggle">
                Forfatter
            </label>
            <button
                id="post-author-toggle"
                type="button"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label={`Forfatter: ${authorSelectLabel(value, poster)}`}
                onClick={() => setOpen(v => !v)}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring text-left flex items-center justify-between gap-2"
            >
                <span className="truncate">{authorSelectLabel(value, poster)}</span>
                <span className="text-muted-foreground shrink-0" aria-hidden>▾</span>
            </button>
            <p className="text-xs text-muted-foreground mt-1">
                Standard er den, der opretter indlægget. Vælg en deltager, hvis du skriver på vegne af en anden.
            </p>

            {open && (
                <div className="absolute z-20 mt-1 w-full bg-card border border-border rounded-lg shadow-xl overflow-hidden">
                    <input
                        ref={searchRef}
                        type="search"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Escape') {
                                setOpen(false);
                                setQuery('');
                            }
                        }}
                        placeholder="Søg deltager…"
                        className="w-full px-3 py-2 border-b border-border text-sm bg-background text-foreground focus:outline-none"
                    />
                    <ul role="listbox" className="max-h-60 overflow-y-auto">
                        {showPoster && (
                            <li>
                                <button
                                    type="button"
                                    role="option"
                                    aria-selected={posterSelected}
                                    onClick={selectPoster}
                                    className={`w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center justify-between gap-2 ${posterSelected ? 'bg-muted font-medium' : ''}`}
                                >
                                    <span className="truncate">{poster.authorName}</span>
                                    <span className="text-xs text-muted-foreground shrink-0">Aktuel bruger</span>
                                </button>
                            </li>
                        )}
                        {participantsQuery.isLoading && (
                            <li className="px-3 py-2 text-sm text-muted-foreground">Indlæser deltagere...</li>
                        )}
                        {!participantsQuery.isLoading && filtered.map(p => {
                            const selected = value.authorZwiftId === p.zwiftId;
                            return (
                                <li key={p.zwiftId}>
                                    <button
                                        type="button"
                                        role="option"
                                        aria-selected={selected}
                                        onClick={() => {
                                            onChange(participantAuthorValue(p));
                                            setOpen(false);
                                            setQuery('');
                                        }}
                                        className={`w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center justify-between gap-2 ${selected ? 'bg-muted font-medium' : ''}`}
                                    >
                                        <span className="truncate">{p.name}</span>
                                        {p.club ? (
                                            <span className="text-xs text-muted-foreground truncate shrink min-w-0">{p.club}</span>
                                        ) : null}
                                    </button>
                                </li>
                            );
                        })}
                        {!participantsQuery.isLoading && filtered.length === 0 && !showPoster && (
                            <li className="px-3 py-2 text-sm text-muted-foreground">Ingen deltagere matcher</li>
                        )}
                    </ul>
                </div>
            )}
        </div>
    );
}
