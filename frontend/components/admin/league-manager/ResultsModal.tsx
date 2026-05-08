'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { db } from '@/lib/firebase';
import { doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';
import type { Race, RaceResult, LoadingStatus, DualRecordingVerification } from '@/types/admin';
import type { DualRecordingResult } from '@/hooks/useDualRecording';
import DualRecordingStatusBadge from '@/components/DualRecordingStatusBadge';
import DualRecordingResultModal from '@/components/DualRecordingResultModal';
import ComposeEmailModal from '@/components/admin/ComposeEmailModal';
import EmailRecipientControls, { EmailRecipientControlItem } from '@/components/admin/EmailRecipientControls';
import { defaultDcuSignatureHtml, withDcuSignature } from '@/lib/email-signature';

const CATEGORY_RANK = [
    'Diamond', 'Ruby', 'Emerald', 'Sapphire', 'Amethyst', 'Platinum', 'Gold', 'Silver', 'Bronze', 'Copper',
    'A', 'B', 'C', 'D', 'E',
];

interface ResultsModalProps {
    race: Race | null;
    status: LoadingStatus;
    onClose: () => void;
    onRaceUpdate: (updatedRace: Race) => void;
    embedded?: boolean;
}

interface UserDirectoryRow {
    userId: string;
    zwiftId: string;
    name: string;
    email: string;
}

interface ComposeRecipient {
    userId?: string;
    zwiftId: string;
    name: string;
    email: string;
}

export default function ResultsModal({
    race,
    status,
    onClose,
    onRaceUpdate,
    embedded = false,
}: ResultsModalProps) {
    const { user } = useAuth();
    const [drVerifications, setDrVerifications] = useState<Map<string, DualRecordingVerification>>(new Map());
    const [drModal, setDrModal] = useState<{
        name: string;
        zwiftId: string;
        activityId?: string;
        verification: DualRecordingVerification;
    } | null>(null);
    const [singleDrRunning, setSingleDrRunning] = useState(false);
    const [singleDrStatus, setSingleDrStatus] = useState<{ type: 'info' | 'success' | 'error'; text: string } | null>(null);
    const [drDetailLoading, setDrDetailLoading] = useState(false);
    const [drDetailError, setDrDetailError] = useState<string | null>(null);
    const [drDetailResult, setDrDetailResult] = useState<DualRecordingResult | null>(null);
    const [usersByZwiftId, setUsersByZwiftId] = useState<Map<string, UserDirectoryRow>>(new Map());
    const [isComposeOpen, setIsComposeOpen] = useState(false);
    const [composeTitle, setComposeTitle] = useState('Send email');
    const [composeRecipients, setComposeRecipients] = useState<ComposeRecipient[]>([]);
    const [emailSubject, setEmailSubject] = useState('');
    const [emailMessage, setEmailMessage] = useState('');
    const [sendingEmail, setSendingEmail] = useState(false);
    const [sendError, setSendError] = useState<string | null>(null);
    const [sendStatus, setSendStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [sendMode, setSendMode] = useState<'individual' | 'group'>('individual');
    const [recipientMode, setRecipientMode] = useState<'to' | 'cc' | 'bcc'>('to');
    const [manualTo, setManualTo] = useState('');
    const [manualCc, setManualCc] = useState('');
    const [manualBcc, setManualBcc] = useState('');
    const [toError, setToError] = useState<string | null>(null);
    const [ccError, setCcError] = useState<string | null>(null);
    const [bccError, setBccError] = useState<string | null>(null);
    const [recipientsOpen, setRecipientsOpen] = useState(false);

    const loadDrVerifications = async (raceId: string): Promise<Map<string, DualRecordingVerification>> => {
        if (!user) return new Map<string, DualRecordingVerification>();
        try {
            const token = await user.getIdToken();
            const res = await fetch(`${API_URL}/admin/races/${raceId}/dr-verifications`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) return new Map<string, DualRecordingVerification>();
            const body = await res.json();
            const map = new Map<string, DualRecordingVerification>();
            (body.verifications || []).forEach((v: DualRecordingVerification & { zwiftId?: string | number }) => {
                const key = String(v.zwiftId || '');
                if (!key) return;
                map.set(key, v);
            });
            setDrVerifications(map);
            return map;
        } catch {
            // Keep UI stable on background load errors.
            return new Map<string, DualRecordingVerification>();
        }
    };

    useEffect(() => {
        if (!race || !user) return;
        void loadDrVerifications(race.id);
    }, [race?.id, user]);

    useEffect(() => {
        if (!user) return;
        const loadUsers = async () => {
            try {
                const token = await user.getIdToken();
                const res = await fetch(`${API_URL}/admin/users`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (!res.ok) return;
                const body = await res.json();
                const map = new Map<string, UserDirectoryRow>();
                (body.users || []).forEach((row: UserDirectoryRow) => {
                    const key = String(row.zwiftId || '').trim();
                    if (!key) return;
                    map.set(key, row);
                });
                setUsersByZwiftId(map);
            } catch {
                // Keep modal functionality even if user directory lookup fails.
            }
        };
        void loadUsers();
    }, [user]);

    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const parseManualEmails = useCallback((raw: string) => {
        if (!raw.trim()) return { valid: [] as string[], invalid: [] as string[] };
        const candidates = raw.split(',').map((part) => part.trim()).filter(Boolean);
        return {
            valid: candidates.filter((email) => EMAIL_RE.test(email)),
            invalid: candidates.filter((email) => !EMAIL_RE.test(email)),
        };
    }, []);

    const isMessageEmpty = useCallback(
        (html: string) => html.replace(/<[^>]*>/g, '').trim().length === 0,
        [],
    );

    const composeRecipientItems = useMemo<EmailRecipientControlItem[]>(
        () => composeRecipients
            .map((recipient) => ({
                id: recipient.userId || recipient.zwiftId,
                name: recipient.name || recipient.zwiftId,
                email: recipient.email || '',
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        [composeRecipients],
    );
    const selectedWithoutEmail = composeRecipients.filter((recipient) => !recipient.email?.trim()).length;

    const closeComposeModal = useCallback(() => {
        if (sendingEmail) return;
        setIsComposeOpen(false);
        setComposeRecipients([]);
        setEmailSubject('');
        setEmailMessage('');
        setSendError(null);
        setManualTo('');
        setManualCc('');
        setManualBcc('');
        setToError(null);
        setCcError(null);
        setBccError(null);
        setRecipientsOpen(false);
    }, [sendingEmail]);

    const firstNameFrom = useCallback((name: string) => {
        const trimmed = (name || '').trim();
        if (!trimmed) return '';
        return trimmed.split(/\s+/)[0] || '';
    }, []);

    const toComposeRecipient = useCallback((rider: Pick<RaceResult, 'zwiftId' | 'name'>): ComposeRecipient => {
        const zwiftId = String(rider.zwiftId || '').trim();
        const mapped = usersByZwiftId.get(zwiftId);
        return {
            userId: mapped?.userId,
            zwiftId,
            name: mapped?.name || rider.name || zwiftId,
            email: mapped?.email || '',
        };
    }, [usersByZwiftId]);

    const openComposeForIndividual = useCallback((rider: RaceResult) => {
        const recipient = toComposeRecipient(rider);
        const firstName = firstNameFrom(recipient.name);
        const greeting = firstName ? `Hej ${firstName}` : 'Hej';
        const body = [
            `<p>${greeting}</p>`,
            '<p><br></p>',
            '<p>Venlig hilsen<br>DCU Udvalg for e-cykling</p>',
        ].join('');

        setComposeTitle(`Email til ${recipient.name || recipient.zwiftId}`);
        setComposeRecipients([recipient]);
        setSendMode('individual');
        setRecipientMode('to');
        setEmailSubject('Resultat af dual recording');
        setEmailMessage(body);
        setSendError(null);
        setSendStatus(null);
        setManualTo('');
        setManualCc('');
        setManualBcc('');
        setToError(null);
        setCcError(null);
        setBccError(null);
        setRecipientsOpen(false);
        setIsComposeOpen(true);
    }, [firstNameFrom, toComposeRecipient]);

    const loadDualRecordingDetail = async (
        riderZwiftId: string,
        activityId?: string,
        stravaActivityId?: number | null,
    ): Promise<void> => {
        if (!user) return;

        setDrDetailLoading(true);
        setDrDetailError(null);
        try {
            const token = await user.getIdToken();
            const params = new URLSearchParams();
            if (activityId) {
                params.set('zwiftActivityId', String(activityId));
            }
            if (stravaActivityId != null) {
                params.set('stravaActivityId', String(stravaActivityId));
            }
            if (race?.id) {
                params.set('raceId', String(race.id));
            }
            const res = await fetch(
                `${API_URL}/admin/verification/dual-recording/${riderZwiftId}?${params.toString()}`,
                { headers: { Authorization: `Bearer ${token}` } },
            );
            const data = await res.json();
            if (!res.ok) {
                setDrDetailResult(null);
                setDrDetailError(data?.message || 'Failed to load DR stream graph');
                return;
            }
            setDrDetailResult(data as DualRecordingResult);

            // Keep summary status/CP table in sync with detail stream payload.
            // The detail endpoint may compute/persist fresher DR data than the
            // currently loaded drVerifications map.
            if (race?.id) {
                const latest = await loadDrVerifications(race.id);
                const updated = latest.get(riderZwiftId);
                if (updated) {
                    setDrModal(prev => {
                        if (!prev || prev.zwiftId !== riderZwiftId) return prev;
                        const prevKey = `${prev.verification.status}|${prev.verification.verifiedAt}|${prev.verification.stravaActivityId ?? ''}`;
                        const nextKey = `${updated.status}|${updated.verifiedAt}|${updated.stravaActivityId ?? ''}`;
                        if (prevKey === nextKey) return prev;
                        return { ...prev, verification: updated };
                    });
                }
            }
        } catch {
            setDrDetailResult(null);
            setDrDetailError('Network error while loading DR stream graph');
        } finally {
            setDrDetailLoading(false);
        }
    };

    useEffect(() => {
        if (!drModal) {
            setDrDetailResult(null);
            setDrDetailError(null);
            setDrDetailLoading(false);
            return;
        }
        const stravaId = drModal.verification.stravaActivityId ?? null;
        void loadDualRecordingDetail(drModal.zwiftId, drModal.activityId, stravaId);
    }, [drModal?.zwiftId, drModal?.activityId, drModal?.verification?.stravaActivityId, user]);

    const handleRunSingleDR = async () => {
        if (!race || !user || !drModal) return;
        setSingleDrRunning(true);
        setSingleDrStatus({ type: 'info', text: 'Running DR verification for rider...' });
        try {
            const token = await user.getIdToken();
            const res = await fetch(
                `${API_URL}/admin/races/${race.id}/verify-dual-recording/${drModal.zwiftId}`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ activityId: drModal.activityId || null }),
                },
            );
            const body = await res.json();
            if (!res.ok) {
                setSingleDrStatus({ type: 'error', text: body.message || 'Failed to run DR for rider' });
                return;
            }

            const latest = await loadDrVerifications(race.id);
            const updated = latest.get(drModal.zwiftId);
            if (updated) {
                setDrModal(prev => prev ? { ...prev, verification: updated } : prev);
            }
            const nextStravaId = updated?.stravaActivityId ?? drModal.verification.stravaActivityId ?? null;
            await loadDualRecordingDetail(drModal.zwiftId, drModal.activityId, nextStravaId);
            setSingleDrStatus({
                type: 'success',
                text: body.message || 'DR verification completed for rider.',
            });
        } catch {
            setSingleDrStatus({ type: 'error', text: 'Network error while running rider DR' });
        } finally {
            setSingleDrRunning(false);
        }
    };

    const drBulkRecipients = useMemo<ComposeRecipient[]>(() => {
        if (!race) return [];
        const seen = new Set<string>();
        const recipients: ComposeRecipient[] = [];
        Object.values(race.results || {}).forEach((categoryResults) => {
            (categoryResults || []).forEach((rider) => {
                const riderZwiftId = String(rider.zwiftId || '').trim();
                if (!riderZwiftId || seen.has(riderZwiftId) || !drVerifications.has(riderZwiftId)) return;
                seen.add(riderZwiftId);
                recipients.push(toComposeRecipient(rider));
            });
        });
        return recipients.sort((a, b) => a.name.localeCompare(b.name));
    }, [race, drVerifications, toComposeRecipient]);

    const openComposeForBulkDR = useCallback(() => {
        if (drBulkRecipients.length === 0) {
            setSendStatus({ type: 'error', text: 'Ingen DR-ryttere fundet til email.' });
            return;
        }

        const body = [
            '<p>Hej</p>',
            '<p>Resultatet af din dual recording er nu klar til gennemsyn på resultatsiden.</p>',
            '<p>Venlig hilsen<br>DCU Udvalg for e-cykling</p>',
        ].join('');

        setComposeTitle('Email til alle DR-ryttere');
        setComposeRecipients(drBulkRecipients);
        setSendMode('group');
        setRecipientMode('to');
        setEmailSubject('Dual recording resultat er klar');
        setEmailMessage(body);
        setSendError(null);
        setSendStatus(null);
        setManualTo('');
        setManualCc('');
        setManualBcc('');
        setToError(null);
        setCcError(null);
        setBccError(null);
        setRecipientsOpen(false);
        setIsComposeOpen(true);
    }, [drBulkRecipients]);

    const handleSendEmail = useCallback(async () => {
        if (!user || sendingEmail) return;
        if (composeRecipients.length === 0) {
            setSendError('Ingen modtagere valgt.');
            return;
        }
        const subject = emailSubject.trim();
        if (!subject || isMessageEmpty(emailMessage)) {
            setSendError('Subject and message are required.');
            return;
        }

        const { invalid: toInvalid } = parseManualEmails(manualTo);
        const { invalid: ccInvalid } = parseManualEmails(manualCc);
        const { invalid: bccInvalid } = parseManualEmails(manualBcc);
        let hasFieldError = false;
        if (toInvalid.length > 0) { setToError(`Invalid: ${toInvalid.join(', ')}`); hasFieldError = true; } else setToError(null);
        if (ccInvalid.length > 0) { setCcError(`Invalid: ${ccInvalid.join(', ')}`); hasFieldError = true; } else setCcError(null);
        if (bccInvalid.length > 0) { setBccError(`Invalid: ${bccInvalid.join(', ')}`); hasFieldError = true; } else setBccError(null);
        if (hasFieldError) return;

        const userIds = Array.from(new Set(composeRecipients.map((recipient) => recipient.userId).filter(Boolean)));
        const zwiftIds = Array.from(new Set(composeRecipients.map((recipient) => recipient.zwiftId).filter(Boolean)));
        if (userIds.length === 0 && zwiftIds.length === 0) {
            setSendError('Ingen gyldige modtagere fundet.');
            return;
        }

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
                    userIds,
                    zwiftIds,
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

            const summary = data.summary ?? {};
            setSendStatus({
                type: 'success',
                text: `Email sendt. ${summary.sent ?? 0} sendt, ${summary.skipped ?? 0} sprunget over, ${summary.failed ?? 0} fejlede.`,
            });
            closeComposeModal();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to send email';
            setSendError(message);
        } finally {
            setSendingEmail(false);
        }
    }, [
        user,
        sendingEmail,
        composeRecipients,
        emailSubject,
        emailMessage,
        isMessageEmpty,
        parseManualEmails,
        manualTo,
        manualCc,
        manualBcc,
        sendMode,
        recipientMode,
        closeComposeModal,
    ]);

    if (!race) return null;

    const results = race.results || {};

    // Sort categories based on known rank order (with event config as tiebreaker in multi mode).
    let categories = Object.keys(results);
    const rankIndex = new Map<string, number>(CATEGORY_RANK.map((cat, idx) => [cat.toLowerCase(), idx]));

    if (race.eventMode === 'multi' && race.eventConfiguration) {
        const orderMap = new Map();
        race.eventConfiguration.forEach((cfg, idx) => {
            if (cfg.customCategory) orderMap.set(cfg.customCategory, idx);
        });
        
        categories.sort((a, b) => {
            const rankA = rankIndex.has(a.toLowerCase()) ? rankIndex.get(a.toLowerCase())! : 999;
            const rankB = rankIndex.has(b.toLowerCase()) ? rankIndex.get(b.toLowerCase())! : 999;
            if (rankA !== rankB) return rankA - rankB;

            const idxA = orderMap.has(a) ? orderMap.get(a) : 999;
            const idxB = orderMap.has(b) ? orderMap.get(b) : 999;
            if (idxA !== idxB) return idxA - idxB;
            return a.localeCompare(b);
        });
    } else {
        categories.sort((a, b) => {
            const rankA = rankIndex.has(a.toLowerCase()) ? rankIndex.get(a.toLowerCase())! : 999;
            const rankB = rankIndex.has(b.toLowerCase()) ? rankIndex.get(b.toLowerCase())! : 999;
            if (rankA !== rankB) return rankA - rankB;
            return a.localeCompare(b);
        });
    }

    const handleToggleDQ = async (zwiftId: string, isCurrentlyDQ: boolean) => {
        try {
            const raceRef = doc(db, 'races', race.id);
            if (isCurrentlyDQ) {
                await updateDoc(raceRef, {
                    manualDQs: arrayRemove(zwiftId),
                });
            } else {
                await updateDoc(raceRef, {
                    manualDQs: arrayUnion(zwiftId),
                    manualDeclassifications: arrayRemove(zwiftId),
                });
            }
            
            // Update local state
            const updatedRace = {
                ...race,
                manualDQs: isCurrentlyDQ
                    ? (race.manualDQs || []).filter(id => id !== zwiftId)
                    : [...(race.manualDQs || []), zwiftId],
                manualDeclassifications: isCurrentlyDQ
                    ? race.manualDeclassifications
                    : (race.manualDeclassifications || []).filter(id => id !== zwiftId),
            };
            onRaceUpdate(updatedRace);
        } catch (e) {
            console.error("Error updating DQ status:", e);
            alert("Failed to update DQ status");
        }
    };

    const handleToggleDeclass = async (zwiftId: string, isCurrentlyDeclass: boolean) => {
        try {
            const raceRef = doc(db, 'races', race.id);
            if (isCurrentlyDeclass) {
                await updateDoc(raceRef, {
                    manualDeclassifications: arrayRemove(zwiftId),
                });
            } else {
                await updateDoc(raceRef, {
                    manualDeclassifications: arrayUnion(zwiftId),
                    manualDQs: arrayRemove(zwiftId),
                });
            }
            
            // Update local state
            const updatedRace = {
                ...race,
                manualDeclassifications: isCurrentlyDeclass
                    ? (race.manualDeclassifications || []).filter(id => id !== zwiftId)
                    : [...(race.manualDeclassifications || []), zwiftId],
                manualDQs: isCurrentlyDeclass
                    ? race.manualDQs
                    : (race.manualDQs || []).filter(id => id !== zwiftId),
            };
            onRaceUpdate(updatedRace);
        } catch (e) {
            console.error("Error updating Declass status:", e);
            alert("Failed to update Declass status");
        }
    };

    const handleToggleExclude = async (zwiftId: string, isCurrentlyExcluded: boolean) => {
        try {
            const raceRef = doc(db, 'races', race.id);
            if (isCurrentlyExcluded) {
                await updateDoc(raceRef, {
                    manualExclusions: arrayRemove(zwiftId),
                });
            } else {
                await updateDoc(raceRef, {
                    manualExclusions: arrayUnion(zwiftId),
                    manualDQs: arrayRemove(zwiftId),
                    manualDeclassifications: arrayRemove(zwiftId),
                });
            }
            
            // Update local state
            const updatedRace = {
                ...race,
                manualExclusions: isCurrentlyExcluded
                    ? (race.manualExclusions || []).filter(id => id !== zwiftId)
                    : [...(race.manualExclusions || []), zwiftId],
                manualDQs: isCurrentlyExcluded
                    ? race.manualDQs
                    : (race.manualDQs || []).filter(id => id !== zwiftId),
                manualDeclassifications: isCurrentlyExcluded
                    ? race.manualDeclassifications
                    : (race.manualDeclassifications || []).filter(id => id !== zwiftId),
            };
            onRaceUpdate(updatedRace);
        } catch (e) {
            console.error("Error updating exclusion status:", e);
            alert("Failed to update exclusion status");
        }
    };

    const content = (
        <div className={embedded ? "bg-card w-full rounded-lg shadow border border-border flex flex-col" : "bg-card w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-lg shadow-2xl border border-border flex flex-col"}>
                <div className="p-4 border-b border-border bg-muted/30 space-y-3">
                    <div className="flex justify-between items-start gap-3">
                        <div>
                            <h3 className="text-lg font-bold text-card-foreground">Results: {race.name}</h3>
                            {race.date && (
                                <p className="text-xs text-muted-foreground mt-0.5">{race.date}</p>
                            )}
                        </div>
                        <div className="flex justify-end">
                    {!embedded && (
                        <button 
                            onClick={onClose}
                            className="text-muted-foreground hover:text-foreground p-1"
                        >
                            ✕
                        </button>
                    )}
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            onClick={openComposeForBulkDR}
                            className="text-sm bg-primary text-primary-foreground px-3 py-1.5 rounded hover:opacity-90 disabled:opacity-60"
                            disabled={drBulkRecipients.length === 0}
                        >
                            Email alle DR-ryttere
                        </button>
                        <span className="text-xs text-muted-foreground">
                            {drBulkRecipients.length} DR-ryttere i dette løb
                        </span>
                    </div>
                    {sendStatus && (
                        <p className={`text-xs ${sendStatus.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                            {sendStatus.text}
                        </p>
                    )}
                </div>
                
                <div className={`${embedded ? 'p-4' : 'overflow-y-auto p-4'} space-y-6`}>
                    {categories.length === 0 ? (
                        <div className="text-center text-muted-foreground p-8">
                            No results calculated yet.
                        </div>
                    ) : (
                        <>
                            {/* Excluded Riders Section */}
                            {(race.manualExclusions || []).length > 0 && (
                                <div className="border border-border rounded-lg p-3 bg-muted/20 text-xs">
                                    <div className="font-semibold text-muted-foreground mb-2">Excluded Riders</div>
                                    <div className="flex flex-wrap gap-2">
                                        {(race.manualExclusions || []).map((zid: string) => (
                                            <button
                                                key={zid}
                                                onClick={() => handleToggleExclude(zid, true)}
                                                className="px-2 py-1 rounded border border-border bg-background hover:bg-muted/50 text-muted-foreground"
                                                title="Remove exclusion"
                                            >
                                                {zid} ×
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Results by Category */}
                            {categories.map(cat => (
                                <CategoryResultsTable
                                    key={cat}
                                    category={cat}
                                    results={results[cat] as RaceResult[]}
                                    manualDQs={race.manualDQs || []}
                                    manualDeclassifications={race.manualDeclassifications || []}
                                    manualExclusions={race.manualExclusions || []}
                                    drVerifications={drVerifications}
                                    onToggleDQ={handleToggleDQ}
                                    onToggleDeclass={handleToggleDeclass}
                                    onToggleExclude={handleToggleExclude}
                                    onOpenDR={(name, zwiftId, activityId, v) => {
                                        setSingleDrStatus(null);
                                        const fallbackActivityId =
                                            activityId
                                            || v.activityId
                                            || v.zwiftActivityId;
                                        setDrModal({ name, zwiftId, activityId: fallbackActivityId, verification: v });
                                    }}
                                    onOpenEmail={openComposeForIndividual}
                                />
                            ))}
                        </>
                    )}
                </div>
        </div>
    );

    return (
        <>
            {embedded ? (
                content
            ) : (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    {content}
                </div>
            )}
            {drModal && (
                <DualRecordingResultModal
                    open
                    onClose={() => setDrModal(null)}
                    riderName={drModal.name}
                    verification={drModal.verification}
                    onRunForRider={handleRunSingleDR}
                    runForRiderBusy={singleDrRunning}
                    runForRiderStatus={singleDrStatus}
                    streamResult={drDetailResult}
                    streamLoading={drDetailLoading}
                    streamError={drDetailError}
                />
            )}
            <ComposeEmailModal
                isOpen={isComposeOpen}
                title={composeTitle}
                subject={emailSubject}
                onSubjectChange={setEmailSubject}
                onMessageChange={setEmailMessage}
                initialMessage={emailMessage}
                onClose={closeComposeModal}
                onSend={handleSendEmail}
                sending={sendingEmail}
                sendDisabled={composeRecipients.length === 0}
                sendLabel="Send email"
                sendingLabel="Sender..."
                error={sendError}
                beforeSubject={(
                    <EmailRecipientControls
                        recipientsOpen={recipientsOpen}
                        onToggleOpen={() => setRecipientsOpen((open) => !open)}
                        recipients={composeRecipientItems}
                        selectedCount={composeRecipients.length}
                        selectedWithoutEmail={selectedWithoutEmail}
                        sendMode={sendMode}
                        onSendModeChange={setSendMode}
                        recipientMode={recipientMode}
                        onRecipientModeChange={setRecipientMode}
                        manualTo={manualTo}
                        manualCc={manualCc}
                        manualBcc={manualBcc}
                        manualToCount={parseManualEmails(manualTo).valid.length || '...'}
                        manualCcCount={parseManualEmails(manualCc).valid.length || '...'}
                        manualBccCount={parseManualEmails(manualBcc).valid.length || '...'}
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
        </>
    );
}

// Sub-component for category results table
interface CategoryResultsTableProps {
    category: string;
    results: RaceResult[];
    manualDQs: string[];
    manualDeclassifications: string[];
    manualExclusions: string[];
    drVerifications: Map<string, DualRecordingVerification>;
    onToggleDQ: (zwiftId: string, isCurrentlyDQ: boolean) => void;
    onToggleDeclass: (zwiftId: string, isCurrentlyDeclass: boolean) => void;
    onToggleExclude: (zwiftId: string, isCurrentlyExcluded: boolean) => void;
    onOpenDR: (riderName: string, zwiftId: string, activityId: string | undefined, v: DualRecordingVerification) => void;
    onOpenEmail: (rider: RaceResult) => void;
}

function CategoryResultsTable({
    category,
    results,
    manualDQs,
    manualDeclassifications,
    manualExclusions,
    drVerifications,
    onToggleDQ,
    onToggleDeclass,
    onToggleExclude,
    onOpenDR,
    onOpenEmail,
}: CategoryResultsTableProps) {
    return (
        <div className="border border-border rounded-lg overflow-hidden">
            <div className="bg-secondary/50 px-4 py-2 font-semibold text-sm border-b border-border">
                {category}
            </div>
            <table className="w-full table-fixed text-left text-sm">
                <thead className="bg-muted/20 text-xs text-muted-foreground">
                    <tr>
                        <th className="px-4 py-2 w-12">Pos</th>
                        <th className="px-4 py-2">Rider</th>
                        <th className="px-4 py-2 text-center w-20">Status</th>
                        <th className="px-4 py-2 text-center w-24">Time</th>
                        <th className="px-4 py-2 text-right">Pts</th>
                        <th className="px-4 py-2 text-center w-16">Flags</th>
                        <th className="px-4 py-2 text-center w-14" title="Dual Recording">DR</th>
                        <th className="px-4 py-2 text-center w-12" title="Disqualify (0 pts)">DQ</th>
                        <th className="px-4 py-2 text-center w-12" title="Declassify (Last place pts)">DC</th>
                        <th className="px-4 py-2 text-center w-12" title="Exclude from results">EX</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-border">
                    {results.map((rider, idx) => {
                        const riderZwiftId = String(rider.zwiftId);
                        const isFlagged = rider.flaggedCheating || rider.flaggedSandbagging;
                        const isManualDQ = manualDQs.includes(riderZwiftId);
                        const isManualDeclass = manualDeclassifications.includes(riderZwiftId);
                        const isManualExcluded = manualExclusions.includes(riderZwiftId);
                        const raceStatus = String(rider.raceStatus || (rider.finishTime > 0 ? 'FIN' : 'DNF')).toUpperCase();
                        const statusLabel = isManualExcluded
                            ? 'EX'
                            : isManualDQ
                                ? 'DQ'
                                : isManualDeclass
                                    ? 'DC'
                                    : raceStatus;
                        const hidePoints = statusLabel === 'DNF' || statusLabel === 'EX';
                        
                        let rowClass = 'hover:bg-muted/10';
                        if (isManualExcluded) {
                            rowClass += ' bg-slate-50 dark:bg-slate-900/30';
                        } else if (isFlagged || isManualDQ) {
                            rowClass += ' bg-red-50 dark:bg-red-950/20';
                        } else if (isManualDeclass) {
                            rowClass += ' bg-yellow-50 dark:bg-yellow-950/20';
                        }

                        return (
                    <tr key={riderZwiftId} className={rowClass}>
                                <td className="px-4 py-2 text-muted-foreground">
                                    {isManualExcluded ? '×' : isManualDQ ? '-' : isManualDeclass ? '*' : idx + 1}
                                </td>
                                <td className="px-4 py-2 font-medium">
                                    {rider.name}
                                    {isFlagged && (
                                        <div className="text-[10px] text-red-600 font-bold mt-0.5">
                                            {rider.flaggedCheating ? 'CHEATING ' : ''}
                                            {rider.flaggedSandbagging ? 'SANDBAGGING' : ''}
                                        </div>
                                    )}
                                    {isManualExcluded && (
                                        <div className="text-[10px] text-slate-600 font-bold mt-0.5">EXCLUDED</div>
                                    )}
                                    {isManualDQ && (
                                        <div className="text-[10px] text-red-600 font-bold mt-0.5">DISQUALIFIED</div>
                                    )}
                                    {isManualDeclass && (
                                        <div className="text-[10px] text-yellow-600 font-bold mt-0.5">DECLASSIFIED</div>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => onOpenEmail(rider)}
                                        className="mt-1 inline-flex text-[11px] px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40"
                                    >
                                        Email
                                    </button>
                                </td>
                                <td className="px-4 py-2 text-center font-semibold text-muted-foreground w-20">
                                    {statusLabel}
                                </td>
                                <td className="px-4 py-2 text-center font-mono text-muted-foreground w-24">
                                    {rider.finishTime > 0
                                        ? new Date(rider.finishTime).toISOString().substr(11, 8)
                                        : 'DNF'}
                                </td>
                                <td className="px-4 py-2 text-right font-bold text-primary">
                                    {hidePoints ? '-' : rider.totalPoints}
                                    {(isManualExcluded || (isManualDQ && rider.totalPoints > 0) || (isManualDeclass && rider.totalPoints === 0)) && (
                                        <span className="text-[10px] text-red-500 block" title="Recalculation needed">
                                            (Recalc)
                                        </span>
                                    )}
                                </td>
                                <td className="px-4 py-2 text-center">
                                    {isFlagged ? <span className="text-xl" title="Flagged">🚩</span> : <span className="text-muted-foreground">-</span>}
                                </td>
                                <td className="px-4 py-2 text-center">
                                    {drVerifications.has(riderZwiftId) ? (
                                        <DualRecordingStatusBadge
                                            verification={drVerifications.get(riderZwiftId)}
                                            onClick={() => onOpenDR(rider.name, riderZwiftId, rider.activityId, drVerifications.get(riderZwiftId)!)}
                                        />
                                    ) : (
                                        <span className="text-muted-foreground">-</span>
                                    )}
                                </td>
                                <td className="px-4 py-2 text-center">
                                    <input 
                                        type="checkbox"
                                        checked={isManualDQ}
                                        onChange={() => onToggleDQ(riderZwiftId, isManualDQ)}
                                        disabled={isManualDeclass || isManualExcluded}
                                        title={isManualExcluded ? "Excluded from results" : isManualDeclass ? "Uncheck Declassify first" : "Disqualify"}
                                        className="w-4 h-4 rounded border-input text-primary focus:ring-primary cursor-pointer disabled:opacity-30"
                                    />
                                </td>
                                <td className="px-4 py-2 text-center">
                                    <input 
                                        type="checkbox"
                                        checked={isManualDeclass}
                                        onChange={() => onToggleDeclass(riderZwiftId, isManualDeclass)}
                                        disabled={isManualDQ || isManualExcluded}
                                        title={isManualExcluded ? "Excluded from results" : isManualDQ ? "Uncheck DQ first" : "Declassify"}
                                        className="w-4 h-4 rounded border-input text-yellow-500 focus:ring-yellow-500 cursor-pointer disabled:opacity-30"
                                    />
                                </td>
                                <td className="px-4 py-2 text-center">
                                    <input 
                                        type="checkbox"
                                        checked={isManualExcluded}
                                        onChange={() => onToggleExclude(riderZwiftId, isManualExcluded)}
                                        title={isManualExcluded ? "Include in results" : "Exclude from results"}
                                        className="w-4 h-4 rounded border-input text-slate-600 focus:ring-slate-500 cursor-pointer"
                                    />
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
