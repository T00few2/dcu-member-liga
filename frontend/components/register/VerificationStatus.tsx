'use client';

import { useState, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';
import { fromTimestamp } from '@/lib/formatDate';
import { useProfileDrVerificationsQuery } from '@/hooks/queries/useProfileDrVerificationsQuery';
import { useNotificationStateQuery } from '@/hooks/queries/useNotificationStateQuery';
import DualRecordingStatusBadge from '@/components/DualRecordingStatusBadge';
import DualRecordingResultModal from '@/components/DualRecordingResultModal';
import StickyWattsStatusBadge from '@/components/StickyWattsStatusBadge';
import WeightVideoSubmitForm from '@/components/WeightVideoSubmitForm';
import { useLeagueSettingsQuery } from '@/hooks/queries/useLeagueSettingsQuery';
import type { ProfileDrVerification } from '@/hooks/queries/useProfileDrVerificationsQuery';

interface VerificationRequest {
    requestId: string;
    requestedAt?: { seconds: number } | string | null;
    submittedAt?: { seconds: number } | string | null;
    status: 'pending' | 'submitted' | 'approved' | 'rejected' | 'revoked';
    videoLink?: string;
    rejectionReason?: string;
    deadline?: { seconds: number } | string | null;
    weighInDate?: string;
    source?: string;
}

interface VerificationStatusProps {
    status: 'none' | 'pending' | 'submitted' | 'approved' | 'rejected';
    deadline?: unknown;
    requests?: VerificationRequest[];
    refreshProfile: () => void;
    trainerRequiresDualRecording?: boolean;
    dualRecordingOptIn?: boolean;
    ligaCategory?: string | null;
}

type Tab = 'vægt' | 'dual-recording' | 'sticky-watts';

export default function VerificationStatus({
    status, deadline, requests = [], refreshProfile,
    trainerRequiresDualRecording = false,
    dualRecordingOptIn = false,
    ligaCategory = null,
}: VerificationStatusProps) {
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const { data: drVerifications = [], isLoading: drLoading } = useProfileDrVerificationsQuery();
    const { data: notifState } = useNotificationStateQuery();
    const { data: leagueSettings } = useLeagueSettingsQuery();
    const [activeTab, setActiveTab] = useState<Tab>('vægt');
    const [selectedDr, setSelectedDr] = useState<ProfileDrVerification | null>(null);
    const [optInBusy, setOptInBusy] = useState(false);
    const [optedIn, setOptedIn] = useState(dualRecordingOptIn);

    useEffect(() => {
        setOptedIn(dualRecordingOptIn);
    }, [dualRecordingOptIn]);

    const validDays = Number(leagueSettings?.weightVerificationValidDays) > 0
        ? Number(leagueSettings?.weightVerificationValidDays)
        : 30;
    const verificationCats = useMemo(
        () => (leagueSettings?.ligaCategories || [])
            .filter((c) => c.requiresVerification === true)
            .map((c) => c.name),
        [leagueSettings?.ligaCategories],
    );
    const isMandatoryDr = trainerRequiresDualRecording && !!ligaCategory && verificationCats.includes(ligaCategory);

    const hasUnseenDr = !!(
        notifState?.latestDrFailedAt &&
        (!notifState.drReportSeenAt || notifState.latestDrFailedAt > notifState.drReportSeenAt)
    );
    const hasUnseenSw = !!(
        notifState?.latestSwFlaggedAt &&
        (!notifState.swReportSeenAt || notifState.latestSwFlaggedAt > notifState.swReportSeenAt)
    );

    useEffect(() => {
        if (!user) return;
        const shouldMarkDr = activeTab === 'dual-recording' && hasUnseenDr;
        const shouldMarkSw = activeTab === 'sticky-watts' && hasUnseenSw;
        if (!shouldMarkDr && !shouldMarkSw) return;

        const endpoint = shouldMarkDr
            ? `${API_URL}/profile/dr-report-seen`
            : `${API_URL}/profile/sw-report-seen`;

        user.getIdToken().then(token =>
            fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
        ).then(() => {
            queryClient.invalidateQueries({ queryKey: ['notification-state', user.uid] });
            queryClient.invalidateQueries({ queryKey: ['profile-dr-verifications', user.uid] });
        }).catch((err) => {
            console.error('Failed to mark report as seen:', err);
        });
    }, [activeTab, user, hasUnseenDr, hasUnseenSw, queryClient]);

    const activeRequest = requests.find(r => r.status === 'pending');
    const displayStatus = status === 'none' && activeRequest ? 'pending' : status;
    const latestApproved = [...requests].reverse().find(r => r.status === 'approved');
    const approvedWeighIn = latestApproved?.weighInDate
        || isoDateFromTimestamp(latestApproved?.submittedAt)
        || isoDateFromTimestamp(latestApproved?.requestedAt);
    const validUntil = approvedWeighIn ? addDaysIso(approvedWeighIn, validDays) : null;
    const approvalValid = Boolean(validUntil && validUntil >= new Date().toISOString().slice(0, 10));

    const hasDrVerifications = drVerifications.length > 0;
    const hasSwVerifications = drVerifications.some(v => v.stickyWatts != null);
    const latestDr = drVerifications.find(v => v.status && v.status !== 'sw_only');
    const latestSw = drVerifications.find(v => v.stickyWatts != null);

    const setOptIn = async (enabled: boolean) => {
        if (!user || isMandatoryDr) return;
        setOptInBusy(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch(`${API_URL}/profile/dual-recording-opt-in`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ enabled }),
            });
            if (!res.ok) throw new Error('Kunne ikke opdatere tilmelding');
            setOptedIn(enabled);
            await refreshProfile();
            queryClient.invalidateQueries({ queryKey: ['profile'] });
        } catch (err) {
            console.error(err);
        } finally {
            setOptInBusy(false);
        }
    };

    const tabs: { id: Tab; label: string; unseen?: boolean }[] = [
        { id: 'vægt', label: 'Vægt' },
        { id: 'dual-recording', label: 'Dual Recording', unseen: hasUnseenDr },
        { id: 'sticky-watts', label: 'Sticky Watts', unseen: hasUnseenSw },
    ];

    const drStatusLabel = isMandatoryDr
        ? 'Påkrævet'
        : optedIn
            ? 'Tilmeldt'
            : 'Ikke tilmeldt';

    return (
        <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-3">
                <SummaryCard
                    title="Vægt"
                    value={
                        displayStatus === 'pending' ? 'Afventer video' :
                        displayStatus === 'submitted' ? 'Til review' :
                        approvalValid && validUntil ? `Godkendt indtil ${formatDa(validUntil)}` :
                        latestApproved ? 'Udløbet' : 'Ingen'
                    }
                />
                <SummaryCard title="Dual recording" value={drStatusLabel} />
                <SummaryCard
                    title="Seneste DR / SW"
                    value={`${latestDr ? latestDr.status : '—'} / ${latestSw?.stickyWatts?.suspicious ? 'mærkelig' : latestSw ? 'ok' : '—'}`}
                />
            </div>

            <div className="flex gap-1 border-b border-border">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        className={`relative px-4 py-2 text-sm font-medium ${
                            activeTab === tab.id
                                ? 'border-b-2 border-primary text-foreground'
                                : 'text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        {tab.label}
                        {tab.unseen && activeTab !== tab.id && (
                            <span className="absolute top-1.5 right-1 w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                        )}
                    </button>
                ))}
            </div>

            {activeTab === 'vægt' && (
                <div className="space-y-6">
                    <div className={`p-6 rounded-lg border ${
                        displayStatus === 'pending'   ? 'bg-orange-50 border-orange-200 dark:bg-orange-900/20 dark:border-orange-800' :
                        displayStatus === 'submitted' ? 'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800' :
                        approvalValid ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800' :
                        displayStatus === 'rejected' ? 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800' :
                        'bg-muted/30 border-border'
                    }`}>
                        <h3 className="text-lg font-bold mb-2">
                            Status: {
                                displayStatus === 'pending'   ? 'Afventer (stikprøve)' :
                                displayStatus === 'submitted' ? 'Indsendt' :
                                approvalValid ? 'Godkendt' :
                                displayStatus === 'rejected' ? 'Afvist' :
                                latestApproved ? 'Udløbet' : 'Ingen aktiv anmodning'
                            }
                        </h3>
                        {displayStatus === 'pending' && (
                            <p className="text-sm">
                                Du er blevet udvalgt til en stikprøve vægtverifikation.
                                {deadline ? <span className="block font-bold mt-1">Frist: {fromTimestamp(deadline as never)?.toLocaleDateString('da-DK')}</span> : null}
                            </p>
                        )}
                        {displayStatus === 'submitted' && (
                            <p className="text-sm">Din video er indsendt og afventer gennemgang af en administrator.</p>
                        )}
                        {approvalValid && validUntil && (
                            <p className="text-sm">Godkendt indtil {formatDa(validUntil)}. Du kan sende en ny video for at forny perioden.</p>
                        )}
                        {latestApproved && !approvalValid && displayStatus !== 'pending' && displayStatus !== 'submitted' && (
                            <p className="text-sm">Din seneste godkendelse er udløbet. Du kan indsende en ny video.</p>
                        )}
                        {displayStatus === 'rejected' && (
                            <p className="text-sm">Din verifikation blev afvist. {activeRequest?.rejectionReason ? `Årsag: ${activeRequest.rejectionReason}` : 'Du kan indsende en ny video.'}</p>
                        )}
                    </div>

                    {displayStatus !== 'submitted' && (
                        <WeightVideoSubmitForm
                            onSubmitted={() => refreshProfile()}
                            validDays={validDays}
                            submitLabel={displayStatus === 'pending' ? 'Indsend verifikation' : 'Indsend frivillig verifikation'}
                        />
                    )}

                    {requests.length > 0 && (
                        <div className="pt-2">
                            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-4">Historik</h4>
                            <div className="space-y-2">
                                {requests.map((req) => {
                                    const weighIn = req.weighInDate || isoDateFromTimestamp(req.submittedAt) || isoDateFromTimestamp(req.requestedAt);
                                    const until = req.status === 'approved' && weighIn ? addDaysIso(weighIn, validDays) : null;
                                    return (
                                        <div key={req.requestId} className="text-sm p-3 bg-muted/30 rounded space-y-1">
                                            <div className="flex justify-between gap-2">
                                                <span className={`font-medium ${
                                                    req.status === 'approved' ? 'text-green-600' :
                                                    req.status === 'rejected' ? 'text-red-600' :
                                                    'text-muted-foreground'
                                                }`}>
                                                    {statusLabel(req.status)}
                                                </span>
                                                <span className="text-xs text-muted-foreground">
                                                    {req.source === 'voluntary' ? 'Frivillig' : 'Stikprøve'}
                                                </span>
                                            </div>
                                            <div className="text-muted-foreground text-xs">
                                                Indvejning: {weighIn ? formatDa(weighIn) : '—'}
                                                {until ? ` · Gyldig til ${formatDa(until)}` : ''}
                                                {req.submittedAt ? ` · Indsendt ${fromTimestamp(req.submittedAt)?.toLocaleDateString('da-DK')}` : ''}
                                            </div>
                                            {req.videoLink && (
                                                <a href={req.videoLink} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
                                                    Åbn video
                                                </a>
                                            )}
                                            {req.status === 'rejected' && req.rejectionReason && (
                                                <div className="text-red-500 text-xs italic">Årsag: {req.rejectionReason}</div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'dual-recording' && (
                <div className="space-y-4">
                    <div className="p-4 rounded-lg border border-border bg-muted/20 text-sm space-y-3">
                        {isMandatoryDr ? (
                            <p>
                                Din hometrainer og kategori kræver dual recording. Resultater vises på resultatlister,
                                og en administrator kan manuelt deklassere ved underkendelse.
                            </p>
                        ) : (
                            <>
                                <p>
                                    Tilmeld dig dual recording-tjek på hvert løb du gennemfører. Et <strong>godkendt</strong> tjek
                                    kan vises på resultater. Et <strong>underkendt</strong> tjek ses kun af dig og administratorer
                                    og deklassificerer ikke automatisk.
                                </p>
                                <button
                                    type="button"
                                    disabled={optInBusy}
                                    onClick={() => void setOptIn(!optedIn)}
                                    className="px-4 py-2 rounded bg-primary text-primary-foreground font-semibold disabled:opacity-50"
                                >
                                    {optInBusy ? 'Gemmer...' : optedIn ? 'Afmeld dual recording-tjek' : 'Tilmeld dual recording-tjek'}
                                </button>
                            </>
                        )}
                    </div>

                    {drLoading ? (
                        <div className="p-8 text-center text-muted-foreground">Indlæser...</div>
                    ) : !hasDrVerifications ? (
                        <div className="p-8 text-center bg-gray-50 dark:bg-gray-900 rounded-lg border border-border">
                            <h3 className="text-xl font-bold mb-2">Ingen dual recording verifikationer endnu</h3>
                            <p className="text-muted-foreground">Resultater vises her efter løb, hvor tjekket er kørt.</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {drVerifications.filter(v => v.status !== 'sw_only').map((v) => (
                                <DrHistoryRow key={`${v.archiveId || 'live'}-${v.raceId}-${v.verifiedAt}`} v={v} onOpen={() => setSelectedDr(v)} />
                            ))}
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'sticky-watts' && (
                <div className="space-y-4">
                    <div className="flex items-start gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-200">
                        <p>
                            <strong>Eksperimentel funktion</strong> — Sticky Watts-analysen er under udvikling.
                            Resultaterne er til information og ikke grundlag for en afgørelse.
                        </p>
                    </div>
                    {drLoading ? (
                        <div className="p-8 text-center text-muted-foreground">Indlæser...</div>
                    ) : !hasSwVerifications ? (
                        <div className="p-8 text-center bg-gray-50 dark:bg-gray-900 rounded-lg border border-border">
                            <h3 className="text-xl font-bold mb-2">Ingen Sticky Watts-data</h3>
                            <p className="text-muted-foreground">Der er ingen Sticky Watts-analyser tilgængelige for dig endnu.</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {drVerifications.filter(v => v.stickyWatts != null).map((v) => (
                                <div key={`${v.archiveId || 'live'}-sw-${v.raceId}-${v.swVerifiedAt || v.verifiedAt}`} className="flex justify-between items-center text-sm p-3 bg-muted/30 rounded">
                                    <div className="flex items-center gap-3">
                                        <StickyWattsStatusBadge stickyWatts={v.stickyWatts} trainerName={v.trainerName} />
                                        <span className="text-muted-foreground">
                                            {v.verifiedAt ? new Date(v.verifiedAt).toLocaleDateString('da-DK') : '—'}
                                        </span>
                                        <RaceLink v={v} />
                                    </div>
                                    {v.stickyWatts?.suspicious && (
                                        <span className="text-xs text-amber-600 font-medium">Mærkelig</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {selectedDr && (
                <DualRecordingResultModal
                    open={!!selectedDr}
                    onClose={() => setSelectedDr(null)}
                    riderName={user?.displayName || user?.email || ''}
                    verification={selectedDr}
                    showRunActions={false}
                />
            )}
        </div>
    );
}

function SummaryCard({ title, value }: { title: string; value: string }) {
    return (
        <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
            <div className="font-semibold text-sm mt-1">{value}</div>
        </div>
    );
}

function DrHistoryRow({ v, onOpen }: { v: ProfileDrVerification; onOpen: () => void }) {
    return (
        <div className="flex justify-between items-center text-sm p-3 bg-muted/30 rounded">
            <div className="flex items-center gap-3 min-w-0">
                <DualRecordingStatusBadge verification={v} onClick={onOpen} />
                <span className="text-muted-foreground shrink-0">
                    {v.verifiedAt ? new Date(v.verifiedAt).toLocaleDateString('da-DK') : '—'}
                </span>
                <RaceLink v={v} />
            </div>
            {v.status === 'failed' && (
                <span className="text-xs text-red-600 font-medium shrink-0">Underkendtes</span>
            )}
        </div>
    );
}

function RaceLink({ v }: { v: ProfileDrVerification }) {
    const label = v.raceName || v.raceId || 'Løb';
    const href = v.archiveId ? '/historik' : '/results';
    return (
        <Link href={href} className="text-xs text-primary hover:underline truncate">
            {label}{v.archiveName ? ` · ${v.archiveName}` : ''}
        </Link>
    );
}

function statusLabel(status: string) {
    if (status === 'pending') return 'AFVENTER';
    if (status === 'submitted') return 'INDSENDT';
    if (status === 'approved') return 'GODKENDT';
    if (status === 'rejected') return 'AFVIST';
    if (status === 'revoked') return 'ANNULLERET';
    return status.toUpperCase();
}

function isoDateFromTimestamp(value: unknown): string | null {
    const dt = fromTimestamp(value as never);
    if (!dt) return null;
    return dt.toISOString().slice(0, 10);
}

function addDaysIso(isoDate: string, days: number): string {
    const [y, m, d] = isoDate.split('-').map(Number);
    if (!y || !m || !d) return isoDate;
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + days);
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
}

function formatDa(isoDate: string): string {
    const [y, m, d] = isoDate.split('-');
    if (!y || !m || !d) return isoDate;
    return `${d}.${m}.${y}`;
}
