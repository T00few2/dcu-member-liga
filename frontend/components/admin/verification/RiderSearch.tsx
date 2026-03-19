'use client';

import { useState } from 'react';
import type { Participant } from '@/hooks/useRiderVerification';

interface RiderSearchProps {
    participants: Participant[];
    loading: boolean;
    onSelect: (rider: Participant) => void;
}

export default function RiderSearch({ participants, loading, onSelect }: RiderSearchProps) {
    const [search, setSearch] = useState('');

    const filtered = participants.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.zwiftId || '').includes(search)
    );

    return (
        <div className="bg-card p-6 rounded-lg shadow border border-border mb-8">
            <h2 className="text-xl font-semibold mb-4 text-card-foreground">Rider Selection</h2>
            <div className="relative">
                <input
                    type="text"
                    placeholder="Search by name or Zwift ID..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    disabled={loading}
                    className="w-full p-3 border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-primary outline-none disabled:opacity-50"
                />
                {search && (
                    <div className="absolute z-10 mt-1 w-full bg-card border border-border rounded-lg shadow-xl max-h-60 overflow-y-auto">
                        {filtered.map(p => (
                            <div
                                key={p.zwiftId}
                                onClick={() => { onSelect(p); setSearch(''); }}
                                className="p-3 hover:bg-muted cursor-pointer flex justify-between items-center border-b border-border/50 last:border-0"
                            >
                                <div>
                                    <span className="font-bold text-foreground">{p.name}</span>
                                    <span className="text-sm text-muted-foreground ml-2">({p.category})</span>
                                </div>
                                <span className="text-xs font-mono bg-secondary text-secondary-foreground px-2 py-1 rounded">
                                    {p.zwiftId}
                                </span>
                            </div>
                        ))}
                        {filtered.length === 0 && (
                            <div className="p-4 text-muted-foreground text-center">No riders found</div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
