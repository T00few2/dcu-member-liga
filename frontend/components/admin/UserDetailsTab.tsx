'use client';

import { useState, useEffect, useRef } from 'react';
import { useUserDetailsQuery } from '@/hooks/queries/useUserDetailsQuery';
import { useUsersOverviewQuery } from '@/hooks/queries/useUsersOverviewQuery';
import { UserSearchRow } from './user-details/types';
import UserProfile from './user-details/UserProfile';
import UserCategoryHistory from './user-details/UserCategoryHistory';
import UserVerificationHistory from './user-details/UserVerificationHistory';

// ── Main component ─────────────────────────────────────────────────────────────

interface UserDetailsTabProps {
    initialUserId: string | null;
    onUserSelect: (userId: string) => void;
}

export default function UserDetailsTab({ initialUserId, onUserSelect }: UserDetailsTabProps) {
    // Search
    const [searchQuery, setSearchQuery] = useState('');
    const [showDropdown, setShowDropdown] = useState(false);
    const searchRef = useRef<HTMLDivElement>(null);

    // Selected user id (local UI state)
    const [selectedId, setSelectedId] = useState<string | null>(initialUserId);

    // Sync with URL-driven prop
    useEffect(() => {
        setSelectedId(initialUserId);
    }, [initialUserId]);

    // User list for search autocomplete
    const { data: allUsersData = [] } = useUsersOverviewQuery();
    const allUsers: UserSearchRow[] = allUsersData.map(u => ({
        userId: u.userId,
        zwiftId: u.zwiftId,
        name: u.name,
        email: u.email,
        club: u.club,
    }));

    // Detail + races query
    const {
        data: detailData,
        isLoading: loadingDetail,
        error: detailQueryError,
    } = useUserDetailsQuery(selectedId);

    const detail = detailData?.detail ?? null;
    const races = detailData?.races ?? [];
    const loadingRaces = loadingDetail;
    const detailError = detailQueryError
        ? (detailQueryError instanceof Error ? detailQueryError.message : 'Failed to load user details')
        : null;

    // Search filtering
    const q = searchQuery.trim().toLowerCase();
    const filtered = q.length >= 1
        ? allUsers.filter(u =>
            u.name.toLowerCase().includes(q) ||
            u.email.toLowerCase().includes(q) ||
            u.zwiftId.toLowerCase().includes(q)
        ).slice(0, 10)
        : [];

    // Close dropdown on outside click
    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
                setShowDropdown(false);
            }
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    function selectUser(u: UserSearchRow) {
        setSearchQuery('');
        setShowDropdown(false);
        setSelectedId(u.userId);
        onUserSelect(u.userId);
    }

    return (
        <div className="space-y-6">
            {/* Search */}
            <div ref={searchRef} className="relative max-w-md">
                <label className="block text-sm font-medium text-foreground mb-1">Find user</label>
                <input
                    type="text"
                    value={searchQuery}
                    onChange={e => { setSearchQuery(e.target.value); setShowDropdown(true); }}
                    onFocus={() => setShowDropdown(true)}
                    placeholder="Search by name, email or Zwift ID…"
                    className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                {showDropdown && filtered.length > 0 && (
                    <div className="absolute z-50 mt-1 w-full bg-card border border-border rounded-lg shadow-lg overflow-hidden">
                        {filtered.map(u => (
                            <button
                                key={u.userId}
                                className="w-full text-left px-4 py-2.5 hover:bg-muted/60 transition border-b border-border/50 last:border-0"
                                onMouseDown={e => { e.preventDefault(); selectUser(u); }}
                            >
                                <div className="text-sm font-medium">{u.name}</div>
                                <div className="text-xs text-muted-foreground">{u.email} · {u.zwiftId}</div>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Empty state */}
            {!selectedId && !loadingDetail && (
                <div className="text-center py-16 text-muted-foreground">
                    <p className="text-lg mb-1">No user selected</p>
                    <p className="text-sm">Search above or click a row in the Overview tab.</p>
                </div>
            )}

            {/* Loading */}
            {loadingDetail && (
                <div className="text-center py-16 text-muted-foreground">Loading user details…</div>
            )}

            {/* Error */}
            {detailError && !loadingDetail && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
                    {detailError}
                </div>
            )}

            {/* Detail view */}
            {detail && !loadingDetail && (
                <div className="space-y-5">
                    <UserProfile detail={detail} />

                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        <UserCategoryHistory ligaCategory={detail.ligaCategory} />
                    </div>

                    <UserVerificationHistory
                        verification={detail.verification}
                        races={races}
                        loadingRaces={loadingRaces}
                    />
                </div>
            )}
        </div>
    );
}
