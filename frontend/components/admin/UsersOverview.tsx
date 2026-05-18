'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';
import { useUsersOverviewQuery } from '@/hooks/queries/useUsersOverviewQuery';
import ComposeEmailModal from '@/components/admin/ComposeEmailModal';
import EmailRecipientControls from '@/components/admin/EmailRecipientControls';
import { defaultDcuSignatureHtml, withDcuSignature } from '@/lib/email-signature';

import UsersFilters from './users-overview/UsersFilters';
import UsersTable from './users-overview/UsersTable';
import type { UserRow, SortKey, SortDir } from './users-overview/types';

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
            ? rows.filter((r: UserRow) =>
                r.name.toLowerCase().includes(q) ||
                r.email.toLowerCase().includes(q) ||
                r.club.toLowerCase().includes(q) ||
                r.zwiftId.toLowerCase().includes(q) ||
                r.trainer.toLowerCase().includes(q) ||
                r.category.toLowerCase().includes(q)
            )
            : rows;

        return [...base].sort((a: UserRow, b: UserRow) => {
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
        () => filtered.map((row: UserRow) => getRowId(row)).filter(Boolean),
        [filtered, getRowId]
    );

    const selectedCount = selectedIds.size;
    const selectedFilteredCount = filteredIds.filter(id => selectedIds.has(id)).length;
    const allFilteredSelected = filteredIds.length > 0 && selectedFilteredCount === filteredIds.length;
    const someFilteredSelected = selectedFilteredCount > 0 && !allFilteredSelected;

    const selectedRows = useMemo(
        () => rows.filter((row: UserRow) => selectedIds.has(getRowId(row))),
        [rows, selectedIds, getRowId]
    );
    const selectedRowsSorted = useMemo(
        () => [...selectedRows].sort((a: UserRow, b: UserRow) => a.name.localeCompare(b.name)),
        [selectedRows]
    );
    const selectedWithoutEmail = selectedRows.filter((r: UserRow) => !r.email?.trim()).length;

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
            {/* Toolbar / Filters */}
            <UsersFilters
                search={search}
                onSearchChange={setSearch}
                filteredCount={filtered.length}
                totalCount={rows.length}
                selectedCount={selectedCount}
                selectedFilteredCount={selectedFilteredCount}
                allFilteredSelected={allFilteredSelected}
                filteredEmpty={filteredIds.length === 0}
                onToggleSelectAllFiltered={toggleSelectAllFiltered}
                onClearFilteredSelection={clearFilteredSelection}
                onComposeEmail={openComposeModal}
                onRefresh={() => refetchUsers()}
            />

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
            <UsersTable
                filtered={filtered as UserRow[]}
                selectedIds={selectedIds}
                sortKey={sortKey}
                sortDir={sortDir}
                allFilteredSelected={allFilteredSelected}
                someFilteredSelected={someFilteredSelected}
                filteredEmpty={filteredIds.length === 0}
                onUserSelect={onUserSelect}
                onSort={handleSort}
                onToggleRowSelection={toggleRowSelection}
                onToggleSelectAllFiltered={toggleSelectAllFiltered}
                getRowId={getRowId}
            />

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
                        recipients={selectedRowsSorted.map((row: UserRow) => ({
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
