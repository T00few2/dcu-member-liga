'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';

const RichTextEditor = dynamic(
    () => import('@/components/admin/RichTextEditor'),
    {
        ssr: false,
        loading: () => (
            <div className="min-h-48 border border-border rounded-lg bg-muted/10 animate-pulse" />
        ),
    }
);

interface UserRow {
    userId: string;
    zwiftId: string;
    name: string;
    email: string;
    club: string;
    trainer: string;
    category: string;
    categoryLocked: boolean;
    zwiftConnected: boolean;
    stravaConnected: boolean;
    verificationStatus: string;
    currentRating: number | string;
    max30Rating: number | string;
    phenotype: string;
    signedUpAt: number | null;
}

type SortKey = keyof UserRow;
type SortDir = 'asc' | 'desc';

interface EmailSendSummary {
    requested: number;
    sent: number;
    failed: number;
    skipped: number;
}

const CATEGORY_STYLES: Record<string, string> = {
    Diamond:  'bg-cyan-100 text-cyan-800',
    Ruby:     'bg-red-100 text-red-800',
    Emerald:  'bg-green-100 text-green-800',
    Sapphire: 'bg-blue-100 text-blue-800',
    Amethyst: 'bg-purple-100 text-purple-800',
    Platinum: 'bg-slate-100 text-slate-700',
    Gold:     'bg-yellow-100 text-yellow-800',
    Silver:   'bg-gray-100 text-gray-700',
    Bronze:   'bg-orange-100 text-orange-800',
    Copper:   'bg-amber-100 text-amber-800',
};

const VERIFICATION_STYLES: Record<string, string> = {
    approved:  'bg-green-100 text-green-800',
    submitted: 'bg-blue-100 text-blue-800',
    pending:   'bg-yellow-100 text-yellow-800',
    rejected:  'bg-red-100 text-red-800',
    none:      'bg-gray-100 text-gray-600',
};

function Badge({ label, className }: { label: string; className: string }) {
    return (
        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${className}`}>
            {label}
        </span>
    );
}

function ConnDot({ ok, title }: { ok: boolean; title: string }) {
    return (
        <span
            title={title}
            className={`inline-block w-2.5 h-2.5 rounded-full ${ok ? 'bg-green-500' : 'bg-gray-300'}`}
        />
    );
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
    if (!active) return <span className="ml-1 text-muted-foreground opacity-30">↕</span>;
    return <span className="ml-1">{dir === 'asc' ? '↑' : '↓'}</span>;
}

export default function UsersOverview() {
    const { user } = useAuth();
    const [rows, setRows] = useState<UserRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [sortKey, setSortKey] = useState<SortKey>('club');
    const [sortDir, setSortDir] = useState<SortDir>('asc');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isComposeOpen, setIsComposeOpen] = useState(false);
    const [emailSubject, setEmailSubject] = useState('');
    const [emailMessage, setEmailMessage] = useState('');
    const [sendingEmail, setSendingEmail] = useState(false);
    const [sendError, setSendError] = useState<string | null>(null);
    const [lastSendSummary, setLastSendSummary] = useState<EmailSendSummary | null>(null);
    const selectAllRef = useRef<HTMLInputElement>(null);

    const getRowId = useCallback((row: UserRow) => row.userId || row.zwiftId, []);

    const fetchUsers = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        setError(null);
        try {
            const token = await user.getIdToken();
            const res = await fetch(`${API_URL}/admin/users`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const nextRows = data.users ?? [];
            setRows(nextRows);
            const validIds = new Set(nextRows.map((row: UserRow) => getRowId(row)));
            setSelectedIds(prev => new Set(Array.from(prev).filter(id => validIds.has(id))));
        } catch (e: any) {
            setError(e.message ?? 'Failed to load users');
        } finally {
            setLoading(false);
        }
    }, [user, getRowId]);

    useEffect(() => { fetchUsers(); }, [fetchUsers]);

    const filtered = useMemo(() => {
        const q = search.toLowerCase().trim();
        const base = q
            ? rows.filter(r =>
                r.name.toLowerCase().includes(q) ||
                r.email.toLowerCase().includes(q) ||
                r.club.toLowerCase().includes(q) ||
                r.zwiftId.toLowerCase().includes(q) ||
                r.trainer.toLowerCase().includes(q) ||
                r.category.toLowerCase().includes(q)
            )
            : rows;

        return [...base].sort((a, b) => {
            let av = a[sortKey] ?? '';
            let bv = b[sortKey] ?? '';
            if (typeof av === 'number' && typeof bv === 'number') {
                return sortDir === 'asc' ? av - bv : bv - av;
            }
            av = String(av).toLowerCase();
            bv = String(bv).toLowerCase();
            if (av < bv) return sortDir === 'asc' ? -1 : 1;
            if (av > bv) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
    }, [rows, search, sortKey, sortDir]);

    const filteredIds = useMemo(
        () => filtered.map(row => getRowId(row)).filter(Boolean),
        [filtered, getRowId]
    );

    const selectedCount = selectedIds.size;
    const selectedFilteredCount = filteredIds.filter(id => selectedIds.has(id)).length;
    const allFilteredSelected = filteredIds.length > 0 && selectedFilteredCount === filteredIds.length;
    const someFilteredSelected = selectedFilteredCount > 0 && !allFilteredSelected;

    const selectedRows = useMemo(
        () => rows.filter(row => selectedIds.has(getRowId(row))),
        [rows, selectedIds, getRowId]
    );
    const selectedRowsSorted = useMemo(
        () => [...selectedRows].sort((a, b) => a.name.localeCompare(b.name)),
        [selectedRows]
    );
    const selectedWithoutEmail = selectedRows.filter(r => !r.email?.trim()).length;

    useEffect(() => {
        if (!selectAllRef.current) return;
        selectAllRef.current.indeterminate = someFilteredSelected;
    }, [someFilteredSelected]);

    const handleSort = (key: SortKey) => {
        if (key === sortKey) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortDir('asc');
        }
    };

    const toggleRowSelection = (rowId: string, checked: boolean) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (checked) next.add(rowId);
            else next.delete(rowId);
            return next;
        });
    };

    const toggleSelectAllFiltered = () => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (allFilteredSelected) {
                filteredIds.forEach(id => next.delete(id));
            } else {
                filteredIds.forEach(id => next.add(id));
            }
            return next;
        });
    };

    const clearFilteredSelection = () => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            filteredIds.forEach(id => next.delete(id));
            return next;
        });
    };

    const closeComposeModal = () => {
        if (sendingEmail) return;
        setIsComposeOpen(false);
        setSendError(null);
        setEmailSubject('');
        setEmailMessage('');
    };

    const openComposeModal = () => {
        setIsComposeOpen(true);
        setSendError(null);
    };

    const isMessageEmpty = (html: string) =>
        html.replace(/<[^>]*>/g, '').trim().length === 0;

    const handleSendEmail = async () => {
        if (!user || selectedCount === 0 || sendingEmail) return;
        const subject = emailSubject.trim();
        if (!subject || isMessageEmpty(emailMessage)) {
            setSendError('Subject and message are required.');
            return;
        }
        const message = emailMessage;

        setSendingEmail(true);
        setSendError(null);
        try {
            const token = await user.getIdToken();
            const res = await fetch(`${API_URL}/admin/users/send-email`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    userIds: Array.from(selectedIds),
                    subject,
                    message,
                }),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error ?? `HTTP ${res.status}`);
            }

            const summary: EmailSendSummary = data.summary ?? {
                requested: selectedCount,
                sent: 0,
                failed: 0,
                skipped: 0,
            };
            setLastSendSummary(summary);
            setSelectedIds(new Set());
            closeComposeModal();
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Failed to send email';
            setSendError(msg);
        } finally {
            setSendingEmail(false);
        }
    };

    const Th = ({ label, k }: { label: string; k: SortKey }) => (
        <th
            className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground cursor-pointer select-none whitespace-nowrap hover:text-foreground transition"
            onClick={() => handleSort(k)}
        >
            {label}<SortIcon active={sortKey === k} dir={sortDir} />
        </th>
    );

    if (loading) return (
        <div className="flex items-center justify-center py-20 text-muted-foreground">Loading users…</div>
    );

    if (error) return (
        <div className="flex flex-col items-center gap-4 py-20">
            <p className="text-red-600 font-medium">Error: {error}</p>
            <button onClick={fetchUsers} className="bg-primary text-primary-foreground px-4 py-2 rounded hover:opacity-90 text-sm font-medium">Retry</button>
        </div>
    );

    return (
        <div className="space-y-4 pb-12">
            {/* Toolbar */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3 flex-wrap">
                    <input
                        type="text"
                        placeholder="Search name, email, club, Zwift ID…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="border border-border rounded-lg px-3 py-1.5 text-sm bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-72"
                    />
                    <span className="text-sm text-muted-foreground">{filtered.length} / {rows.length} riders</span>
                    <span className="text-sm text-muted-foreground">{selectedCount} selected</span>
                    <button
                        onClick={toggleSelectAllFiltered}
                        className="text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 transition disabled:opacity-50"
                        disabled={filteredIds.length === 0}
                    >
                        {allFilteredSelected ? 'Deselect filtered' : 'Select all filtered'}
                    </button>
                    <button
                        onClick={clearFilteredSelection}
                        className="text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 transition disabled:opacity-50"
                        disabled={selectedFilteredCount === 0}
                    >
                        Clear filtered
                    </button>
                    <button
                        onClick={openComposeModal}
                        className="text-sm bg-primary text-primary-foreground rounded-lg px-3 py-1.5 transition hover:opacity-90 disabled:opacity-50"
                        disabled={selectedCount === 0}
                    >
                        Compose email
                    </button>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={fetchUsers}
                        className="text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 transition"
                    >
                        Refresh
                    </button>
                </div>
            </div>

            {lastSendSummary && (
                <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
                    Last send: requested {lastSendSummary.requested}, sent {lastSendSummary.sent}, failed {lastSendSummary.failed}, skipped {lastSendSummary.skipped}.
                </div>
            )}

            {/* Table */}
            <div className="rounded-xl border border-border overflow-x-auto shadow-sm">
                <table className="w-full text-sm">
                    <thead className="bg-muted border-b border-border">
                        <tr>
                            <th className="px-3 py-2.5 text-left">
                                <input
                                    ref={selectAllRef}
                                    type="checkbox"
                                    checked={allFilteredSelected}
                                    onChange={toggleSelectAllFiltered}
                                    disabled={filteredIds.length === 0}
                                    aria-label="Select all filtered users"
                                />
                            </th>
                            <Th label="Zwift ID"   k="zwiftId" />
                            <Th label="Name"       k="name" />
                            <Th label="Email"      k="email" />
                            <Th label="Club"       k="club" />
                            <Th label="Trainer"    k="trainer" />
                            <Th label="Kategori"   k="category" />
                            <Th label="vELO (30d)" k="max30Rating" />
                            <Th label="Phenotype"  k="phenotype" />
                            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">Connections</th>
                            <Th label="Verification" k="verificationStatus" />
                            <Th label="Signed up"  k="signedUpAt" />
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {filtered.length === 0 && (
                            <tr>
                                <td colSpan={12} className="px-4 py-8 text-center text-muted-foreground">
                                    No users found.
                                </td>
                            </tr>
                        )}
                        {filtered.map(row => (
                            <tr key={getRowId(row)} className="bg-card hover:bg-muted/50 transition">
                                <td className="px-3 py-2">
                                    <input
                                        type="checkbox"
                                        checked={selectedIds.has(getRowId(row))}
                                        onChange={e => toggleRowSelection(getRowId(row), e.target.checked)}
                                        aria-label={`Select ${row.name}`}
                                    />
                                </td>
                                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{row.zwiftId}</td>
                                <td className="px-3 py-2 font-medium text-foreground whitespace-nowrap">{row.name}</td>
                                <td className="px-3 py-2 text-muted-foreground text-xs">{row.email}</td>
                                <td className="px-3 py-2 whitespace-nowrap">{row.club}</td>
                                <td className="px-3 py-2 text-muted-foreground">{row.trainer || '—'}</td>
                                <td className="px-3 py-2">
                                    {row.category ? (
                                        <Badge
                                            label={row.category}
                                            className={CATEGORY_STYLES[row.category] ?? 'bg-gray-100 text-gray-700'}
                                        />
                                    ) : <span className="text-muted-foreground">—</span>}
                                    {row.categoryLocked && (
                                        <span className="ml-1 text-xs text-muted-foreground" title="Locked after first race">🔒</span>
                                    )}
                                </td>
                                <td className="px-3 py-2 text-right font-mono text-xs">
                                    {row.max30Rating !== '' && row.max30Rating !== 'N/A' ? Number(row.max30Rating).toFixed(0) : '—'}
                                </td>
                                <td className="px-3 py-2 text-muted-foreground capitalize">{row.phenotype || '—'}</td>
                                <td className="px-3 py-2">
                                    <div className="flex items-center gap-2">
                                        <ConnDot ok={row.zwiftConnected}  title={row.zwiftConnected  ? 'Zwift connected'  : 'Zwift not connected'} />
                                        <span className="text-xs text-muted-foreground">Z</span>
                                        <ConnDot ok={row.stravaConnected} title={row.stravaConnected ? 'Strava connected' : 'Strava not connected'} />
                                        <span className="text-xs text-muted-foreground">S</span>
                                    </div>
                                </td>
                                <td className="px-3 py-2">
                                    <Badge
                                        label={row.verificationStatus}
                                        className={VERIFICATION_STYLES[row.verificationStatus] ?? 'bg-gray-100 text-gray-600'}
                                    />
                                </td>
                                <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                                    {row.signedUpAt
                                        ? new Date(row.signedUpAt).toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric' })
                                        : '—'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {isComposeOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-2xl rounded-xl border border-border bg-card p-5 shadow-xl space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-semibold">Compose email</h3>
                            <button
                                onClick={closeComposeModal}
                                className="text-sm text-muted-foreground hover:text-foreground"
                                disabled={sendingEmail}
                            >
                                Close
                            </button>
                        </div>

                        <div className="text-sm text-muted-foreground">
                            Sending to {selectedCount} selected users.
                            {selectedWithoutEmail > 0 && ` ${selectedWithoutEmail} selected user(s) have no email and will be skipped.`}
                        </div>

                        <div className="rounded-lg border border-border bg-muted/30">
                            <div className="px-3 py-2 border-b border-border text-sm font-medium">
                                Recipients ({selectedCount})
                            </div>
                            <div className="max-h-44 overflow-y-auto">
                                {selectedRowsSorted.map(row => (
                                    <div key={getRowId(row)} className="px-3 py-2 text-sm border-b last:border-b-0 border-border">
                                        <div className="font-medium text-foreground">{row.name || row.zwiftId || 'Unknown rider'}</div>
                                        <div className="text-xs text-muted-foreground">
                                            {row.email?.trim() ? row.email : 'No email on profile (will be skipped)'}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="block text-sm font-medium">Subject</label>
                            <input
                                type="text"
                                value={emailSubject}
                                onChange={e => setEmailSubject(e.target.value)}
                                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                placeholder="Email subject"
                                maxLength={200}
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="block text-sm font-medium">Message</label>
                            <RichTextEditor
                                key={isComposeOpen ? 'open' : 'closed'}
                                onChange={setEmailMessage}
                                disabled={sendingEmail}
                            />
                        </div>

                        {sendError && (
                            <p className="text-sm text-red-600">{sendError}</p>
                        )}

                        <div className="flex items-center justify-end gap-2">
                            <button
                                onClick={closeComposeModal}
                                className="text-sm border border-border rounded-lg px-3 py-1.5 hover:bg-muted/50"
                                disabled={sendingEmail}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSendEmail}
                                className="text-sm bg-primary text-primary-foreground rounded-lg px-3 py-1.5 hover:opacity-90 disabled:opacity-60"
                                disabled={sendingEmail || selectedCount === 0}
                            >
                                {sendingEmail ? 'Sending…' : 'Send email'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
