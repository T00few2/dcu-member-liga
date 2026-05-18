'use client';

import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';
import { useUsersOverviewQuery } from '@/hooks/queries/useUsersOverviewQuery';
import ComposeEmailModal from '@/components/admin/ComposeEmailModal';
import EmailRecipientControls from '@/components/admin/EmailRecipientControls';
import { defaultDcuSignatureHtml, withDcuSignature } from '@/lib/email-signature';

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
    needsStravaForDR: boolean;
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
    sendMode?: 'individual' | 'group';
}

interface SendResult {
    userId?: string;
    name?: string;
    email?: string;
    status: string;
    reason?: string;
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

export default function UsersOverview({ onUserSelect }: { onUserSelect?: (userId: string) => void }) {
    const { user } = useAuth();
    const { data: rows = [], isLoading: loading, error: queryError, refetch: refetchUsers } = useUsersOverviewQuery();
    const error = queryError ? (queryError instanceof Error ? queryError.message : 'Failed to load users') : null;
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
    const [lastSendResults, setLastSendResults] = useState<SendResult[]>([]);
    const [failedListOpen, setFailedListOpen] = useState(false);
    const [sendMode, setSendMode] = useState<'individual' | 'group'>('individual');
    const [recipientMode, setRecipientMode] = useState<'to' | 'cc' | 'bcc'>('bcc');
    const [manualTo, setManualTo] = useState('');
    const [manualCc, setManualCc] = useState('');
    const [manualBcc, setManualBcc] = useState('');
    const [toError, setToError] = useState<string | null>(null);
    const [ccError, setCcError] = useState<string | null>(null);
    const [bccError, setBccError] = useState<string | null>(null);
    const [recipientsOpen, setRecipientsOpen] = useState(false);
    const selectAllRef = useRef<HTMLInputElement>(null);

    const getRowId = useCallback((row: UserRow) => row.userId || row.zwiftId, []);

    // Keep selectedIds valid when rows change
    useEffect(() => {
        if (rows.length === 0) return;
        const validIds = new Set(rows.map((row: UserRow) => getRowId(row)));
        setSelectedIds(prev => {
            const filtered = Array.from(prev).filter(id => validIds.has(id));
            if (filtered.length === prev.size) return prev;
            return new Set(filtered);
        });
    }, [rows, getRowId]);

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
        setManualTo('');
        setManualCc('');
        setManualBcc('');
        setToError(null);
        setCcError(null);
        setBccError(null);
        setRecipientsOpen(false);
    };

    const openComposeModal = () => {
        setIsComposeOpen(true);
        setSendError(null);
        setSendMode(selectedIds.size > 20 ? 'group' : 'individual');
        setRecipientMode('to');
        setEmailMessage(defaultDcuSignatureHtml());
        setManualTo('');
        setManualCc('');
        setManualBcc('');
        setRecipientsOpen(false);
        setToError(null);
        setCcError(null);
        setBccError(null);
    };

    const isMessageEmpty = (html: string) =>
        html.replace(/<[^>]*>/g, '').trim().length === 0;

    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const parseManualEmails = (raw: string) => {
        if (!raw.trim()) return { valid: [], invalid: [] };
        const c = raw.split(',').map(s => s.trim()).filter(Boolean);
        return { valid: c.filter(e => EMAIL_RE.test(e)), invalid: c.filter(e => !EMAIL_RE.test(e)) };
    };

    const handleSendEmail = async () => {
        if (!user || selectedCount === 0 || sendingEmail) return;
        const subject = emailSubject.trim();
        if (!subject || isMessageEmpty(emailMessage)) {
            setSendError('Subject and message are required.');
            return;
        }

        const { invalid: toInvalid }  = parseManualEmails(manualTo);
        const { invalid: ccInvalid }  = parseManualEmails(manualCc);
        const { invalid: bccInvalid } = parseManualEmails(manualBcc);
        let hasFieldError = false;
        if (toInvalid.length > 0)  { setToError(`Invalid: ${toInvalid.join(', ')}`);   hasFieldError = true; }
        else setToError(null);
        if (ccInvalid.length > 0)  { setCcError(`Invalid: ${ccInvalid.join(', ')}`);   hasFieldError = true; }
        else setCcError(null);
        if (bccInvalid.length > 0) { setBccError(`Invalid: ${bccInvalid.join(', ')}`); hasFieldError = true; }
        else setBccError(null);
        if (hasFieldError) return;

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
                    message: withDcuSignature(emailMessage),
                    sendMode,
                    ...(sendMode === 'group' ? { recipientMode } : {}),
                    manualTo: manualTo.trim(),
                    manualCc: manualCc.trim(),
                    manualBcc: manualBcc.trim(),
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
            const results: SendResult[] = data.results ?? [];
            setLastSendSummary(summary);
            setLastSendResults(results);
            setFailedListOpen(false);
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
            <button onClick={() => refetchUsers()} className="bg-primary text-primary-foreground px-4 py-2 rounded hover:opacity-90 text-sm font-medium">Retry</button>
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
                        onClick={() => refetchUsers()}
                        className="text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 transition"
                    >
                        Refresh
                    </button>
                </div>
            </div>

            {lastSendSummary && (() => {
                const failedResults = lastSendResults.filter(r => r.status === 'failed' && r.userId);
                const retryIds = failedResults.map(r => r.userId as string);
                return (
                    <div className="rounded-lg border border-border bg-card text-sm overflow-hidden">
                        <div className="px-4 py-3 flex items-center gap-2 flex-wrap">
                            <span className="text-muted-foreground">Last send:</span>
                            {lastSendSummary.sendMode && (
                                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${lastSendSummary.sendMode === 'individual' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                                    {lastSendSummary.sendMode === 'individual' ? 'Individual' : 'Group'}
                                </span>
                            )}
                            <span className="flex-1">
                                {lastSendSummary.requested} requested, {lastSendSummary.skipped} skipped —{' '}
                                {lastSendSummary.sent > 0 && lastSendSummary.failed === 0
                                    ? <span className="text-green-600 font-medium">sent to {lastSendSummary.sent} recipient(s)</span>
                                    : lastSendSummary.sent > 0
                                    ? <span className="text-amber-600 font-medium">sent to {lastSendSummary.sent}, {lastSendSummary.failed} failed</span>
                                    : <span className="text-red-600 font-medium">send failed — check server logs</span>
                                }
                            </span>
                            {retryIds.length > 0 && (
                                <div className="flex items-center gap-2 ml-auto shrink-0">
                                    <button
                                        onClick={() => setFailedListOpen(o => !o)}
                                        className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                                    >
                                        {failedListOpen ? 'Hide' : 'Show'} {retryIds.length} failed
                                    </button>
                                    <button
                                        onClick={() => {
                                            setSelectedIds(new Set(retryIds));
                                            setFailedListOpen(false);
                                        }}
                                        className="text-xs bg-amber-500 text-white rounded px-2 py-1 hover:bg-amber-600 transition font-medium"
                                    >
                                        Retry {retryIds.length} failed
                                    </button>
                                </div>
                            )}
                        </div>
                        {failedListOpen && failedResults.length > 0 && (
                            <div className="border-t border-border">
                                <div className="px-4 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide bg-muted/30">
                                    Failed recipients
                                </div>
                                <div className="max-h-48 overflow-y-auto divide-y divide-border">
                                    {failedResults.map(r => (
                                        <div key={r.userId} className="px-4 py-2 flex items-center gap-3">
                                            <span className="font-medium text-foreground">{r.name || r.userId}</span>
                                            <span className="text-muted-foreground text-xs">{r.email}</span>
                                            {r.reason && (
                                                <span className="ml-auto text-xs text-red-500 truncate max-w-48" title={r.reason}>
                                                    {r.reason}
                                                </span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                );
            })()}

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
                            <tr
                                key={getRowId(row)}
                                className={`bg-card hover:bg-muted/50 transition${onUserSelect ? ' cursor-pointer' : ''}`}
                                onClick={onUserSelect ? () => onUserSelect(getRowId(row)) : undefined}
                            >
                                <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
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
                                        {row.needsStravaForDR && (
                                            <span
                                                title="Trainer requires dual recording but Strava is not connected"
                                                className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-100 text-amber-700 text-xs font-bold leading-none"
                                            >
                                                !
                                            </span>
                                        )}
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

            <ComposeEmailModal
                isOpen={isComposeOpen}
                title="Compose email"
                subject={emailSubject}
                onSubjectChange={setEmailSubject}
                onMessageChange={setEmailMessage}
                initialMessage={emailMessage}
                onClose={closeComposeModal}
                onSend={handleSendEmail}
                sending={sendingEmail}
                sendDisabled={selectedCount === 0}
                sendLabel="Send email"
                sendingLabel="Sending…"
                error={sendError}
                beforeSubject={(
                    <EmailRecipientControls
                        recipientsOpen={recipientsOpen}
                        onToggleOpen={() => setRecipientsOpen(o => !o)}
                        recipients={selectedRowsSorted.map((row) => ({
                            id: getRowId(row),
                            name: row.name || row.zwiftId || 'Unknown rider',
                            email: row.email || '',
                        }))}
                        selectedCount={selectedCount}
                        selectedWithoutEmail={selectedWithoutEmail}
                        sendMode={sendMode}
                        onSendModeChange={setSendMode}
                        recipientMode={recipientMode}
                        onRecipientModeChange={setRecipientMode}
                        manualTo={manualTo}
                        manualCc={manualCc}
                        manualBcc={manualBcc}
                        manualToCount={parseManualEmails(manualTo).valid.length || '…'}
                        manualCcCount={parseManualEmails(manualCc).valid.length || '…'}
                        manualBccCount={parseManualEmails(manualBcc).valid.length || '…'}
                        toError={toError}
                        ccError={ccError}
                        bccError={bccError}
                        onManualToChange={(value) => { setManualTo(value); setToError(null); }}
                        onManualCcChange={(value) => { setManualCc(value); setCcError(null); }}
                        onManualBccChange={(value) => { setManualBcc(value); setBccError(null); }}
                        sending={sendingEmail}
                    />
                )}
            />
        </div>
    );
}
