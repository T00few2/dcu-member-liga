'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ToastProvider';
import { API_URL } from '@/lib/api';
import { useWeightVerificationsListQuery } from '@/hooks/queries/useWeightVerificationsListQuery';
import { useRacesQuery } from '@/hooks/queries/useRacesQuery';
import ComposeEmailModal from '@/components/admin/ComposeEmailModal';
import { defaultDcuSignatureHtml, withDcuSignature } from '@/lib/email-signature';
import WeightVerificationList, {
    PendingVerification,
    RevisitDecision,
} from './weight-verification/WeightVerificationList';
import WeightVerificationDetail, {
    RevisitState,
} from './weight-verification/WeightVerificationDetail';

interface RaceOption {
    id: string;
    name: string;
    dateLabel: string;
    totalFinishers: number;
    sortTs: number;
}

function parseRaceDate(value: unknown): Date | null {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getFinishedRaces(rawRaces: any[]): RaceOption[] {
    const out: RaceOption[] = [];
    for (const race of rawRaces || []) {
        const results = race?.results;
        if (!results || typeof results !== 'object') continue;

        const finisherIds = new Set<string>();
        for (const riders of Object.values(results)) {
            if (!Array.isArray(riders)) continue;
            for (const rider of riders) {
                if (!rider || typeof rider !== 'object') continue;
                const zid = String((rider as any).zwiftId ?? '').trim();
                const finishTime = Number((rider as any).finishTime ?? 0);
                if (zid && finishTime > 0) finisherIds.add(zid);
            }
        }
        if (finisherIds.size === 0) continue;

        const dt = parseRaceDate(race?.date) ?? parseRaceDate(race?.resultsUpdatedAt);
        out.push({
            id: String(race?.id ?? race?._id ?? ''),
            name: String(race?.name ?? 'Unnamed race'),
            dateLabel: dt ? dt.toLocaleString() : 'Unknown date',
            totalFinishers: finisherIds.size,
            sortTs: dt ? dt.getTime() : 0,
        });
    }

    out.sort((a, b) => b.sortTs - a.sortTs);
    return out.filter(r => r.id);
}

function getFirstName(fullName: string): string {
    const first = (fullName || '').trim().split(/\s+/).filter(Boolean)[0];
    return first || '';
}

export default function WeightVerificationManager() {
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const { showToast } = useToast();

    const {
        data: verificationsData,
        isLoading: loading,
        refetch: refetchVerifications,
    } = useWeightVerificationsListQuery();

    const { data: racesData } = useRacesQuery();

    const pendingReviews = verificationsData?.pending ?? [];
    const activeRequests = verificationsData?.requests ?? [];
    const approvedList = verificationsData?.approved ?? [];
    const rejectedList = verificationsData?.rejected ?? [];

    const raceOptions: RaceOption[] = racesData ? getFinishedRaces(racesData as any[]) : [];

    // Trigger State
    const [triggerPercent, setTriggerPercent] = useState(5);
    const [deadlineDays, setDeadlineDays] = useState(2);
    const [triggering, setTriggering] = useState(false);
    const [selectedRaceId, setSelectedRaceId] = useState<string>('');

    // Sync selectedRaceId when raceOptions becomes available
    const firstRaceId = raceOptions[0]?.id ?? '';
    useEffect(() => {
        if (!firstRaceId) return;
        setSelectedRaceId(prev => {
            if (prev && raceOptions.some(r => r.id === prev)) return prev;
            return firstRaceId;
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [firstRaceId]);

    // Review State
    const [reviewingId, setReviewingId] = useState<string | null>(null);
    const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({});
    const [isComposeOpen, setIsComposeOpen] = useState(false);
    const [composeTarget, setComposeTarget] = useState<Pick<PendingVerification, 'id' | 'name' | 'email'> | null>(null);
    const [emailSubject, setEmailSubject] = useState('');
    const [emailMessage, setEmailMessage] = useState('');
    const [sendingEmail, setSendingEmail] = useState(false);
    const [sendError, setSendError] = useState<string | null>(null);
    const [revisitState, setRevisitState] = useState<RevisitState | null>(null);
    const [revisitDecision, setRevisitDecision] = useState<RevisitDecision>('approve');
    const [revisitReason, setRevisitReason] = useState('');

    // Revoke State
    const [revokingId, setRevokingId] = useState<string | null>(null);

    const handleTrigger = async () => {
        if (!user) return;
        if (!selectedRaceId) {
            showToast('No finished race available to sample from', 'error');
            return;
        }
        const raceText = raceOptions.find(r => r.id === selectedRaceId)?.name || selectedRaceId;
        if (!confirm(`Are you sure you want to verify ${triggerPercent}% of finishers from ${raceText}? This will send notifications/requirements to them.`)) return;

        setTriggering(true);
        try {
            const token = await user.getIdToken();
            const payload: Record<string, unknown> = {
                percentage: triggerPercent,
                deadlineDays,
                raceId: selectedRaceId,
            };
            const res = await fetch(`${API_URL}/admin/verification/trigger`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (res.ok) {
                showToast(data.message || 'Verification triggered!', 'success');
                await queryClient.invalidateQueries({ queryKey: ['admin', 'weight-verifications'] });
            } else {
                showToast(data.message || 'Failed to trigger', 'error');
            }
        } catch (e) {
            showToast('Network error triggering verification', 'error');
        } finally {
            setTriggering(false);
        }
    };

    const handleRevoke = async (id: string) => {
        if (!user) return;
        if (!confirm('Are you sure you want to revoke this verification request? The rider will no longer be required to submit.')) return;

        setRevokingId(id);
        try {
            const token = await user.getIdToken();
            const res = await fetch(`${API_URL}/admin/verification/revoke/${id}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (res.ok) {
                showToast('Verification request revoked', 'success');
                await queryClient.invalidateQueries({ queryKey: ['admin', 'weight-verifications'] });
            } else {
                const data = await res.json();
                showToast(data.message || 'Failed to revoke', 'error');
            }
        } catch (e) {
            showToast('Network error revoking verification', 'error');
        } finally {
            setRevokingId(null);
        }
    };

    const handleReview = async (id: string, action: 'approve' | 'reject', reasonOverride?: string): Promise<boolean> => {
        if (!user) return false;
        const reviewReason = reasonOverride ?? rejectionReasons[id] ?? '';
        if (action === 'reject' && !reviewReason && !confirm('Reject without a reason?')) return false;

        setReviewingId(id);
        try {
            const token = await user.getIdToken();
            const res = await fetch(`${API_URL}/admin/verification/review`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: id,
                    action,
                    reason: reviewReason
                })
            });

            if (res.ok) {
                showToast(`Rider ${action}d successfully`, 'success');
                setRejectionReasons(prev => { const next = { ...prev }; delete next[id]; return next; });
                await queryClient.invalidateQueries({ queryKey: ['admin', 'weight-verifications'] });
                return true;
            } else {
                const data = await res.json();
                showToast(data.message || 'Review failed', 'error');
                return false;
            }
        } catch (e) {
            showToast('Network error submitting review', 'error');
            return false;
        } finally {
            setReviewingId(null);
        }
    };

    const openRevisitModal = (
        id: string,
        name: string,
        currentDecision: RevisitDecision,
        currentReason?: string,
    ) => {
        setRevisitState({
            id,
            name,
            currentDecision,
            currentReason: currentReason || '',
        });
        setRevisitDecision(currentDecision);
        setRevisitReason(currentReason || '');
    };

    const closeRevisitModal = () => {
        if (reviewingId) return;
        setRevisitState(null);
        setRevisitDecision('approve');
        setRevisitReason('');
    };

    const submitRevisit = async () => {
        if (!revisitState || reviewingId) return;
        const ok = await handleReview(revisitState.id, revisitDecision, revisitReason);
        if (ok) {
            closeRevisitModal();
        }
    };

    const openComposeModal = (
        target: Pick<PendingVerification, 'id' | 'name' | 'email'>,
        template: 'default' | 'awaitingSubmission' = 'default'
    ) => {
        const firstName = getFirstName(target.name);
        const greeting = firstName ? `<p>Hej ${firstName}</p><p><br></p>` : '<p>Hej</p><p><br></p>';
        const awaitingSalutation = firstName ? `Hej ${firstName}` : 'Hej';
        const awaitingSubmissionBody = [
            `<p>${awaitingSalutation}<br><br>`,
            'Du er blevet tilfældigt udvalgt til vægtverifikation.<br><br>',
            'Du kan se instruktioner og indsende din verifikation her: https://www.dansk-ecykling.dk/register?tab=verification<br></p>',
            defaultDcuSignatureHtml(),
        ].join('');
        const body = template === 'awaitingSubmission' ? awaitingSubmissionBody : '';
        setComposeTarget(target);
        setEmailSubject('Opfølgning på vægtverifikation');
        setEmailMessage(template === 'awaitingSubmission' ? body : `${greeting}${defaultDcuSignatureHtml()}`);
        setSendError(null);
        setIsComposeOpen(true);
    };

    const closeComposeModal = () => {
        if (sendingEmail) return;
        setIsComposeOpen(false);
        setComposeTarget(null);
        setEmailSubject('');
        setEmailMessage('');
        setSendError(null);
    };

    const isMessageEmpty = (html: string) =>
        html.replace(/<[^>]*>/g, '').trim().length === 0;

    const handleSendEmail = async () => {
        if (!user || !composeTarget || sendingEmail) return;
        const subject = emailSubject.trim();
        if (!subject || isMessageEmpty(emailMessage)) {
            setSendError('Subject and message are required.');
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
                    userIds: [composeTarget.id],
                    subject,
                    message: withDcuSignature(emailMessage),
                    sendMode: 'group',
                    recipientMode: 'to',
                }),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error ?? `HTTP ${res.status}`);
            }

            showToast(`Email sent to ${composeTarget.name}`, 'success');
            closeComposeModal();
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Failed to send email';
            setSendError(msg);
        } finally {
            setSendingEmail(false);
        }
    };

    return (
        <div className="space-y-8">
            {/* TRIGGER SECTION */}
            <div className="bg-card p-6 rounded-lg shadow border border-border">
                <h2 className="text-xl font-bold mb-4 text-card-foreground">Trigger Random Verification</h2>
                <div className="flex items-end gap-4">
                    <div>
                        <label className="block text-sm font-medium text-muted-foreground mb-1">Percentage of Riders</label>
                        <div className="relative">
                            <input
                                type="number"
                                min="1"
                                max="100"
                                value={triggerPercent}
                                onChange={(e) => setTriggerPercent(Number(e.target.value))}
                                className="w-24 p-2 bg-background border border-input rounded text-foreground"
                            />
                            <span className="absolute right-3 top-2 text-muted-foreground">%</span>
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-muted-foreground mb-1">Deadline (Days)</label>
                        <input
                            type="number"
                            min="1"
                            max="30"
                            value={deadlineDays}
                            onChange={(e) => setDeadlineDays(Number(e.target.value))}
                            className="w-24 p-2 bg-background border border-input rounded text-foreground"
                        />
                    </div>
                    <div className="min-w-[320px]">
                        <label className="block text-sm font-medium text-muted-foreground mb-1">Source Race</label>
                        <select
                            value={selectedRaceId}
                            onChange={(e) => setSelectedRaceId(e.target.value)}
                            className="w-full p-2 bg-background border border-input rounded text-foreground"
                            disabled={raceOptions.length === 0}
                        >
                            {raceOptions.length === 0 && (
                                <option value="">No finished races found</option>
                            )}
                            {raceOptions.map((race) => (
                                <option key={race.id} value={race.id}>
                                    {race.name} - {race.dateLabel} ({race.totalFinishers} finishers)
                                </option>
                            ))}
                        </select>
                    </div>
                    <button
                        onClick={handleTrigger}
                        disabled={triggering || !selectedRaceId}
                        className="bg-primary text-primary-foreground px-4 py-2 rounded font-bold hover:bg-primary-dark disabled:opacity-50"
                    >
                        {triggering ? 'Triggering...' : 'Start Verification Wave'}
                    </button>
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                    Selected riders will be sampled from finishers in the chosen race and must submit a weight verification video within {deadlineDays} day{deadlineDays === 1 ? '' : 's'}.
                </p>
            </div>

            <WeightVerificationList
                loading={loading}
                activeRequests={activeRequests}
                pendingReviews={pendingReviews}
                approvedList={approvedList}
                rejectedList={rejectedList}
                reviewingId={reviewingId}
                revokingId={revokingId}
                rejectionReasons={rejectionReasons}
                onRejectionReasonChange={(id, reason) =>
                    setRejectionReasons(prev => ({ ...prev, [id]: reason }))
                }
                onRevoke={handleRevoke}
                onReview={handleReview}
                onOpenCompose={openComposeModal}
                onOpenRevisit={openRevisitModal}
                onRefetch={refetchVerifications}
            />

            <WeightVerificationDetail
                revisitState={revisitState}
                revisitDecision={revisitDecision}
                revisitReason={revisitReason}
                reviewingId={reviewingId}
                onDecisionChange={setRevisitDecision}
                onReasonChange={setRevisitReason}
                onClose={closeRevisitModal}
                onSubmit={submitRevisit}
            />

            <ComposeEmailModal
                isOpen={isComposeOpen && !!composeTarget}
                title={composeTarget ? `Email ${composeTarget.name}` : 'Compose email'}
                subject={emailSubject}
                onSubjectChange={setEmailSubject}
                onMessageChange={setEmailMessage}
                initialMessage={emailMessage}
                onClose={closeComposeModal}
                onSend={handleSendEmail}
                sending={sendingEmail}
                sendLabel="Send email"
                sendingLabel="Sending…"
                error={sendError}
                beforeSubject={composeTarget?.email ? (
                    <div className="text-sm text-muted-foreground">
                        Til: <span className="font-medium text-foreground">{composeTarget.email}</span>
                    </div>
                ) : (
                    <div className="text-sm text-amber-600">
                        Til: Ingen email fundet for denne rytter
                    </div>
                )}
            />
        </div>
    );
}
