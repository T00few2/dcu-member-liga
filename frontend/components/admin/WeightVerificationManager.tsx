'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/components/ToastProvider';
import { API_URL } from '@/lib/api';
import ComposeEmailModal from '@/components/admin/ComposeEmailModal';
import { defaultDcuSignatureHtml, withDcuSignature } from '@/lib/email-signature';

interface PendingVerification {
    id: string;
    name: string;
    email?: string;
    club: string;
    videoLink: string;
    submittedAt: string | any;
    lastRaceWeightKg?: number | null;
    lastRaceName?: string | null;
    lastRaceDate?: string | null;
    latestProfileUpdatedAt?: string | null;
}

interface ActiveRequest {
    id: string;
    name: string;
    email?: string;
    club: string;
    deadline: string | any;
}

interface ApprovedVerification {
    id: string;
    name: string;
    club: string;
    approvedAt: string | any;
    approvedBy: string;
    videoLink?: string;
    lastRaceWeightKg?: number | null;
    lastRaceName?: string | null;
    lastRaceDate?: string | null;
    latestProfileUpdatedAt?: string | null;
}

interface RejectedVerification {
    id: string;
    name: string;
    club: string;
    rejectedAt: string | any;
    rejectedBy: string;
    rejectionReason?: string;
    videoLink?: string;
    lastRaceWeightKg?: number | null;
    lastRaceName?: string | null;
    lastRaceDate?: string | null;
    latestProfileUpdatedAt?: string | null;
}

type RevisitDecision = 'approve' | 'reject';

interface RevisitState {
    id: string;
    name: string;
    currentDecision: RevisitDecision;
    currentReason: string;
}

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

function formatCopenhagenDateTime(value: unknown): string | null {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat('da-DK', {
        timeZone: 'Europe/Copenhagen',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
    }).format(d);
}

export default function WeightVerificationManager() {
    const { user } = useAuth();
    const { showToast } = useToast();

    // Trigger State
    const [triggerPercent, setTriggerPercent] = useState(5);
    const [deadlineDays, setDeadlineDays] = useState(2);
    const [triggering, setTriggering] = useState(false);
    const [raceOptions, setRaceOptions] = useState<RaceOption[]>([]);
    const [selectedRaceId, setSelectedRaceId] = useState<string>('');

    // Lists State
    const [pendingReviews, setPendingReviews] = useState<PendingVerification[]>([]);
    const [activeRequests, setActiveRequests] = useState<ActiveRequest[]>([]);
    const [approvedList, setApprovedList] = useState<ApprovedVerification[]>([]);
    const [rejectedList, setRejectedList] = useState<RejectedVerification[]>([]);
    const [loading, setLoading] = useState(true);

    // Review State
    const [reviewingId, setReviewingId] = useState<string | null>(null);
    const [rejectionReason, setRejectionReason] = useState('');
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

    const fetchData = async () => {
        if (!user) return;
        setLoading(true);
        try {
            const token = await user.getIdToken();
            const headers = { 'Authorization': `Bearer ${token}` };

            const [pendingRes, requestsRes, approvedRes, rejectedRes] = await Promise.all([
                fetch(`${API_URL}/admin/verification/pending`, { headers }),
                fetch(`${API_URL}/admin/verification/requests`, { headers }),
                fetch(`${API_URL}/admin/verification/approved`, { headers }),
                fetch(`${API_URL}/admin/verification/rejected`, { headers }),
            ]);

            if (pendingRes.ok) {
                const data = await pendingRes.json();
                setPendingReviews(data.pending || []);
            }
            if (requestsRes.ok) {
                const data = await requestsRes.json();
                setActiveRequests(data.requests || []);
            }
            if (approvedRes.ok) {
                const data = await approvedRes.json();
                setApprovedList(data.approved || []);
            }
            if (rejectedRes.ok) {
                const data = await rejectedRes.json();
                setRejectedList(data.rejected || []);
            }

            const racesRes = await fetch(`${API_URL}/races`, { headers });
            if (racesRes.ok) {
                const racesData = await racesRes.json();
                const finished = getFinishedRaces(racesData.races || []);
                setRaceOptions(finished);
                setSelectedRaceId((prev) => {
                    if (!finished.length) return '';
                    if (prev && finished.some(r => r.id === prev)) return prev;
                    return finished[0].id;
                });
            }
        } catch (e) {
            console.error(e);
            showToast('Failed to load verification data', 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [user]);

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
                fetchData(); // Refresh lists
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
                setActiveRequests(prev => prev.filter(r => r.id !== id));
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
        const reviewReason = reasonOverride ?? rejectionReason;
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
                setRejectionReason('');
                fetchData();
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

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

                {/* AWAITING SUBMISSION LIST */}
                <div className="bg-card p-6 rounded-lg shadow border border-border">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-bold text-card-foreground">Awaiting Submission ({activeRequests.length})</h2>
                    </div>

                    {loading ? (
                        <div className="text-center p-8 text-muted-foreground">Loading...</div>
                    ) : activeRequests.length === 0 ? (
                        <div className="text-center p-8 text-muted-foreground italic bg-muted/20 rounded">
                            No active requests.
                        </div>
                    ) : (
                        <div className="space-y-3 max-h-[500px] overflow-y-auto">
                            {activeRequests.map(req => (
                                <div key={req.id} className="border border-border rounded p-3 bg-secondary/10 flex justify-between items-center">
                                    <div>
                                        <div className="font-bold text-foreground">{req.name}</div>
                                        <div className="text-xs text-muted-foreground">
                                            {req.club || 'No Club'}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        {req.deadline && (
                                            <div className="text-xs text-orange-600 dark:text-orange-400 font-medium">
                                                Due: {new Date(req.deadline).toLocaleDateString()}
                                            </div>
                                        )}
                                        <button
                                            onClick={() => openComposeModal({ id: req.id, name: req.name, email: req.email }, 'awaitingSubmission')}
                                            className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
                                        >
                                            Email
                                        </button>
                                        <button
                                            onClick={() => handleRevoke(req.id)}
                                            disabled={revokingId === req.id}
                                            className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 font-medium"
                                        >
                                            {revokingId === req.id ? 'Revoking...' : 'Revoke'}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* PENDING REVIEWS LIST */}
                <div className="bg-card p-6 rounded-lg shadow border border-border">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-bold text-card-foreground">Pending Reviews ({pendingReviews.length})</h2>
                        <button onClick={fetchData} className="text-sm text-primary hover:underline">Refresh</button>
                    </div>

                    {loading ? (
                        <div className="text-center p-8 text-muted-foreground">Loading...</div>
                    ) : pendingReviews.length === 0 ? (
                        <div className="text-center p-8 text-muted-foreground italic bg-muted/20 rounded">
                            No pending reviews. Good job!
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {pendingReviews.map(req => (
                                <div key={req.id} className="border border-border rounded-lg p-4 bg-card flex flex-col gap-3">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <div className="font-bold text-lg text-foreground">{req.name}</div>
                                            <div className="text-sm text-muted-foreground">
                                                Club: {req.club || 'None'}
                                            </div>
                                            <div className="text-xs text-muted-foreground mt-1">
                                                Submitted: {new Date(req.submittedAt).toLocaleDateString()}
                                            </div>
                                            {req.lastRaceWeightKg != null && (
                                                <div className="text-xs text-muted-foreground mt-1">
                                                    Last race weight: <span className="font-semibold text-foreground">{req.lastRaceWeightKg.toFixed(1)} kg</span>
                                                    {formatCopenhagenDateTime(req.latestProfileUpdatedAt)
                                                        ? ` (updated ${formatCopenhagenDateTime(req.latestProfileUpdatedAt)})`
                                                        : ''}
                                                </div>
                                            )}
                                        </div>
                                        <a
                                            href={req.videoLink}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-blue-500 hover:underline flex items-center gap-1 text-sm font-bold"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                                            View Video
                                        </a>
                                    </div>

                                    <button
                                        onClick={() => openComposeModal({ id: req.id, name: req.name, email: req.email })}
                                        className="self-start px-3 py-2 bg-blue-600 text-white rounded font-bold hover:bg-blue-700 text-sm"
                                    >
                                        Email
                                    </button>

                                    <div className="flex flex-col gap-2 pt-2 border-t border-border mt-2">
                                        {reviewingId === req.id ? (
                                            <div className="flex items-center gap-2 text-muted-foreground justify-center py-2">
                                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                                                Processing...
                                            </div>
                                        ) : (
                                            <>
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => handleReview(req.id, 'approve')}
                                                        className="flex-1 px-3 py-2 bg-green-600 text-white rounded font-bold hover:bg-green-700 text-sm"
                                                    >
                                                        Approve
                                                    </button>
                                                    <button
                                                        onClick={() => handleReview(req.id, 'reject')}
                                                        className="flex-1 px-3 py-2 bg-red-600 text-white rounded font-bold hover:bg-red-700 text-sm"
                                                    >
                                                        Reject
                                                    </button>
                                                </div>
                                                <input
                                                    type="text"
                                                    placeholder="Rejection reason (optional)"
                                                    className="text-sm bg-background border border-input rounded px-2 py-1 w-full"
                                                    value={rejectionReason}
                                                    onChange={(e) => setRejectionReason(e.target.value)}
                                                />
                                            </>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>


            {/* APPROVED LIST */}
            <div className="bg-card p-6 rounded-lg shadow border border-border">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold text-card-foreground">Approved Verifications ({approvedList.length})</h2>
                </div>

                {loading ? (
                    <div className="text-center p-8 text-muted-foreground">Loading...</div>
                ) : approvedList.length === 0 ? (
                    <div className="text-center p-8 text-muted-foreground italic bg-muted/20 rounded">
                        No approved verifications found.
                    </div>
                ) : (
                    <div className="space-y-3 max-h-[500px] overflow-y-auto">
                        {approvedList.map(req => (
                            <div key={req.id} className="border border-border rounded p-3 bg-secondary/10 flex justify-between items-center">
                                <div>
                                    <div className="font-bold text-foreground">{req.name}</div>
                                    <div className="text-xs text-muted-foreground">
                                        {req.club || 'No Club'}
                                    </div>
                                    <div className="text-xs text-green-600 dark:text-green-400 font-medium">
                                        Approved: {new Date(req.approvedAt).toLocaleDateString()} by {req.approvedBy}
                                    </div>
                                    {req.lastRaceWeightKg != null && (
                                        <div className="text-xs text-muted-foreground mt-1">
                                            Registered weight: <span className="font-semibold text-foreground">{req.lastRaceWeightKg.toFixed(1)} kg</span>
                                            {formatCopenhagenDateTime(req.latestProfileUpdatedAt)
                                                ? ` (updated ${formatCopenhagenDateTime(req.latestProfileUpdatedAt)})`
                                                : ''}
                                        </div>
                                    )}
                                    {req.videoLink && (
                                        <a
                                            href={req.videoLink}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-xs text-blue-600 hover:underline mt-1 inline-block"
                                        >
                                            View submitted video
                                        </a>
                                    )}
                                </div>
                                <button
                                    onClick={() => openRevisitModal(req.id, req.name, 'approve')}
                                    disabled={reviewingId === req.id}
                                    className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 font-medium"
                                >
                                    {reviewingId === req.id ? 'Updating...' : 'Revisit'}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* REJECTED LIST */}
            <div className="bg-card p-6 rounded-lg shadow border border-border">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold text-card-foreground">Rejected Verifications ({rejectedList.length})</h2>
                </div>

                {loading ? (
                    <div className="text-center p-8 text-muted-foreground">Loading...</div>
                ) : rejectedList.length === 0 ? (
                    <div className="text-center p-8 text-muted-foreground italic bg-muted/20 rounded">
                        No rejected verifications found.
                    </div>
                ) : (
                    <div className="space-y-3 max-h-[500px] overflow-y-auto">
                        {rejectedList.map(req => (
                            <div key={req.id} className="border border-border rounded p-3 bg-secondary/10 flex justify-between items-center gap-4">
                                <div>
                                    <div className="font-bold text-foreground">{req.name}</div>
                                    <div className="text-xs text-muted-foreground">
                                        {req.club || 'No Club'}
                                    </div>
                                    <div className="text-xs text-red-600 dark:text-red-400 font-medium">
                                        Rejected: {req.rejectedAt ? new Date(req.rejectedAt).toLocaleDateString() : 'Unknown'} by {req.rejectedBy}
                                    </div>
                                    {req.rejectionReason && (
                                        <div className="text-xs text-muted-foreground mt-1">
                                            Reason: {req.rejectionReason}
                                        </div>
                                    )}
                                    {req.lastRaceWeightKg != null && (
                                        <div className="text-xs text-muted-foreground mt-1">
                                            Registered weight: <span className="font-semibold text-foreground">{req.lastRaceWeightKg.toFixed(1)} kg</span>
                                            {formatCopenhagenDateTime(req.latestProfileUpdatedAt)
                                                ? ` (updated ${formatCopenhagenDateTime(req.latestProfileUpdatedAt)})`
                                                : ''}
                                        </div>
                                    )}
                                    {req.videoLink && (
                                        <a
                                            href={req.videoLink}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-xs text-blue-600 hover:underline mt-1 inline-block"
                                        >
                                            View submitted video
                                        </a>
                                    )}
                                </div>
                                <button
                                    onClick={() => openRevisitModal(req.id, req.name, 'reject', req.rejectionReason)}
                                    disabled={reviewingId === req.id}
                                    className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 font-medium"
                                >
                                    {reviewingId === req.id ? 'Updating...' : 'Revisit'}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {revisitState && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
                    <div className="w-full max-w-lg rounded-lg border border-border bg-card p-5 shadow-xl">
                        <h3 className="text-lg font-bold text-card-foreground">Revisit verification</h3>
                        <p className="text-sm text-muted-foreground mt-1">
                            Rider: <span className="font-semibold text-foreground">{revisitState.name}</span>
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                            Current decision: {revisitState.currentDecision}
                        </p>

                        <div className="mt-4 space-y-3">
                            <div>
                                <label className="block text-sm font-medium text-muted-foreground mb-1">New decision</label>
                                <select
                                    value={revisitDecision}
                                    onChange={(e) => setRevisitDecision(e.target.value as RevisitDecision)}
                                    className="w-full p-2 bg-background border border-input rounded text-foreground"
                                >
                                    <option value="approve">Approve</option>
                                    <option value="reject">Reject</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-muted-foreground mb-1">
                                    Text / reason ({revisitDecision === 'reject' ? 'optional but recommended' : 'optional'})
                                </label>
                                <textarea
                                    value={revisitReason}
                                    onChange={(e) => setRevisitReason(e.target.value)}
                                    rows={4}
                                    className="w-full p-2 bg-background border border-input rounded text-foreground"
                                    placeholder="Write reason or note..."
                                />
                            </div>
                        </div>

                        <div className="mt-5 flex justify-end gap-2">
                            <button
                                onClick={closeRevisitModal}
                                disabled={!!reviewingId}
                                className="px-3 py-2 text-sm rounded border border-input hover:bg-secondary disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={submitRevisit}
                                disabled={!!reviewingId}
                                className="px-3 py-2 text-sm rounded bg-primary text-primary-foreground hover:bg-primary-dark disabled:opacity-50 font-semibold"
                            >
                                {reviewingId ? 'Saving...' : 'Save decision'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

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
