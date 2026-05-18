'use client';

import { useState, useCallback, useMemo } from 'react';
import { User } from 'firebase/auth';
import { API_URL } from '@/lib/api';
import type { RaceResult, DualRecordingVerification } from '@/types/admin';
import type { EmailRecipientControlItem } from '@/components/admin/EmailRecipientControls';
import { withDcuSignature } from '@/lib/email-signature';

export interface ComposeRecipient {
    userId?: string;
    zwiftId: string;
    name: string;
    email: string;
}

interface UserDirectoryRow {
    userId: string;
    zwiftId: string;
    name: string;
    email: string;
    trainer?: string;
}

interface UseEmailComposerOptions {
    user: User | null;
    usersByZwiftId: Map<string, UserDirectoryRow>;
    drVerifications: Map<string, DualRecordingVerification>;
    raceResults: Record<string, RaceResult[]>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function useEmailComposer({
    user,
    usersByZwiftId,
    drVerifications,
    raceResults,
}: UseEmailComposerOptions) {
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
    const [manualTo, setManualToRaw] = useState('');
    const [manualCc, setManualCcRaw] = useState('');
    const [manualBcc, setManualBccRaw] = useState('');
    const [toError, setToError] = useState<string | null>(null);
    const [ccError, setCcError] = useState<string | null>(null);
    const [bccError, setBccError] = useState<string | null>(null);
    const [recipientsOpen, setRecipientsOpen] = useState(false);

    const setManualTo = useCallback((v: string) => { setManualToRaw(v); setToError(null); }, []);
    const setManualCc = useCallback((v: string) => { setManualCcRaw(v); setCcError(null); }, []);
    const setManualBcc = useCallback((v: string) => { setManualBccRaw(v); setBccError(null); }, []);

    const parseManualEmails = useCallback((raw: string) => {
        if (!raw.trim()) return { valid: [] as string[], invalid: [] as string[] };
        const candidates = raw.split(',').map(p => p.trim()).filter(Boolean);
        return {
            valid: candidates.filter(e => EMAIL_RE.test(e)),
            invalid: candidates.filter(e => !EMAIL_RE.test(e)),
        };
    }, []);

    const isMessageEmpty = useCallback(
        (html: string) => html.replace(/<[^>]*>/g, '').trim().length === 0,
        [],
    );

    const toComposeRecipient = useCallback(
        (rider: Pick<RaceResult, 'zwiftId' | 'name'>): ComposeRecipient => {
            const zwiftId = String(rider.zwiftId || '').trim();
            const mapped = usersByZwiftId.get(zwiftId);
            return {
                userId: mapped?.userId,
                zwiftId,
                name: mapped?.name || rider.name || zwiftId,
                email: mapped?.email || '',
            };
        },
        [usersByZwiftId],
    );

    const firstNameFrom = useCallback((name: string) => {
        const trimmed = (name || '').trim();
        return trimmed ? (trimmed.split(/\s+/)[0] ?? '') : '';
    }, []);

    const resetComposeState = useCallback(() => {
        setComposeRecipients([]);
        setEmailSubject('');
        setEmailMessage('');
        setSendError(null);
        setManualToRaw('');
        setManualCcRaw('');
        setManualBccRaw('');
        setToError(null);
        setCcError(null);
        setBccError(null);
        setRecipientsOpen(false);
    }, []);

    const closeComposeModal = useCallback(() => {
        if (sendingEmail) return;
        setIsComposeOpen(false);
        resetComposeState();
    }, [sendingEmail, resetComposeState]);

    const openComposeForIndividual = useCallback(
        (rider: RaceResult) => {
            const recipient = toComposeRecipient(rider);
            const firstName = firstNameFrom(recipient.name);
            const greeting = firstName ? `Hej ${firstName}` : 'Hej';
            const body = [
                `<p>${greeting}</p>`,
                '<p><br></p>',
                '<p>Venlig hilsen<br>DCU Udvalg for e-cykling</p>',
            ].join('');

            resetComposeState();
            setComposeTitle(`Email til ${recipient.name || recipient.zwiftId}`);
            setComposeRecipients([recipient]);
            setSendMode('individual');
            setRecipientMode('to');
            setEmailSubject('Resultat af dual recording');
            setEmailMessage(body);
            setSendStatus(null);
            setIsComposeOpen(true);
        },
        [toComposeRecipient, firstNameFrom, resetComposeState],
    );

    const drBulkRecipients = useMemo<ComposeRecipient[]>(() => {
        const seen = new Set<string>();
        const recipients: ComposeRecipient[] = [];
        Object.values(raceResults).forEach(categoryResults => {
            (categoryResults || []).forEach(rider => {
                const zwiftId = String(rider.zwiftId || '').trim();
                if (!zwiftId || seen.has(zwiftId) || !drVerifications.has(zwiftId)) return;
                seen.add(zwiftId);
                recipients.push(toComposeRecipient(rider));
            });
        });
        return recipients.sort((a, b) => a.name.localeCompare(b.name));
    }, [raceResults, drVerifications, toComposeRecipient]);

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

        resetComposeState();
        setComposeTitle('Email til alle DR-ryttere');
        setComposeRecipients(drBulkRecipients);
        setSendMode('group');
        setRecipientMode('to');
        setEmailSubject('Dual recording resultat er klar');
        setEmailMessage(body);
        setSendStatus(null);
        setIsComposeOpen(true);
    }, [drBulkRecipients, resetComposeState]);

    const handleSendEmail = useCallback(async () => {
        if (!user || sendingEmail) return;
        if (composeRecipients.length === 0) { setSendError('Ingen modtagere valgt.'); return; }
        const subject = emailSubject.trim();
        if (!subject || isMessageEmpty(emailMessage)) { setSendError('Subject and message are required.'); return; }

        const { invalid: toInvalid } = parseManualEmails(manualTo);
        const { invalid: ccInvalid } = parseManualEmails(manualCc);
        const { invalid: bccInvalid } = parseManualEmails(manualBcc);
        let hasFieldError = false;
        if (toInvalid.length > 0) { setToError(`Invalid: ${toInvalid.join(', ')}`); hasFieldError = true; } else setToError(null);
        if (ccInvalid.length > 0) { setCcError(`Invalid: ${ccInvalid.join(', ')}`); hasFieldError = true; } else setCcError(null);
        if (bccInvalid.length > 0) { setBccError(`Invalid: ${bccInvalid.join(', ')}`); hasFieldError = true; } else setBccError(null);
        if (hasFieldError) return;

        const userIds = Array.from(new Set(composeRecipients.map(r => r.userId).filter(Boolean)));
        const zwiftIds = Array.from(new Set(composeRecipients.map(r => r.zwiftId).filter(Boolean)));
        if (userIds.length === 0 && zwiftIds.length === 0) { setSendError('Ingen gyldige modtagere fundet.'); return; }

        setSendingEmail(true);
        setSendError(null);
        try {
            const token = await user.getIdToken();
            const res = await fetch(`${API_URL}/admin/users/send-email`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userIds, zwiftIds, subject,
                    message: withDcuSignature(emailMessage),
                    sendMode,
                    ...(sendMode === 'group' ? { recipientMode } : {}),
                    manualTo: manualTo.trim(),
                    manualCc: manualCc.trim(),
                    manualBcc: manualBcc.trim(),
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
            const summary = data.summary ?? {};
            setSendStatus({
                type: 'success',
                text: `Email sendt. ${summary.sent ?? 0} sendt, ${summary.skipped ?? 0} sprunget over, ${summary.failed ?? 0} fejlede.`,
            });
            closeComposeModal();
        } catch (err) {
            setSendError(err instanceof Error ? err.message : 'Failed to send email');
        } finally {
            setSendingEmail(false);
        }
    }, [
        user, sendingEmail, composeRecipients, emailSubject, emailMessage,
        isMessageEmpty, parseManualEmails, manualTo, manualCc, manualBcc,
        sendMode, recipientMode, closeComposeModal,
    ]);

    const composeRecipientItems = useMemo<EmailRecipientControlItem[]>(
        () =>
            composeRecipients
                .map(r => ({ id: r.userId || r.zwiftId, name: r.name || r.zwiftId, email: r.email || '' }))
                .sort((a, b) => a.name.localeCompare(b.name)),
        [composeRecipients],
    );

    const selectedWithoutEmail = composeRecipients.filter(r => !r.email?.trim()).length;

    return {
        isComposeOpen,
        composeTitle,
        composeRecipients,
        composeRecipientItems,
        selectedWithoutEmail,
        emailSubject, setEmailSubject,
        emailMessage, setEmailMessage,
        sendingEmail,
        sendError,
        sendStatus, setSendStatus,
        sendMode, setSendMode,
        recipientMode, setRecipientMode,
        manualTo, setManualTo,
        manualCc, setManualCc,
        manualBcc, setManualBcc,
        toError, ccError, bccError,
        recipientsOpen, setRecipientsOpen,
        drBulkRecipients,
        openComposeForIndividual,
        openComposeForBulkDR,
        handleSendEmail,
        closeComposeModal,
        parseManualEmails,
    };
}
