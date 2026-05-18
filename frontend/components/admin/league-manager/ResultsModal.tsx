'use client';

import { useCallback } from 'react';
import { db } from '@/lib/firebase';
import { doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { useAuth } from '@/lib/auth-context';
import type {
    Race,
    RaceResult,
    LoadingStatus,
    DualRecordingVerification,
    WeightVerificationRecord,
} from '@/types/admin';
import { useAdminVerifications } from '@/hooks/useAdminVerifications';
import { useEmailComposer } from '@/hooks/useEmailComposer';
import DualRecordingStatusBadge from '@/components/DualRecordingStatusBadge';
import WeightVerificationStatusBadge from '@/components/WeightVerificationStatusBadge';
import StickyWattsStatusBadge from '@/components/StickyWattsStatusBadge';
import DualRecordingResultModal from '@/components/DualRecordingResultModal';
import ComposeEmailModal from '@/components/admin/ComposeEmailModal';
import EmailRecipientControls from '@/components/admin/EmailRecipientControls';

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

const formatDisplayDate = (value: unknown): string => {
    if (!value) return '';
    const ts = value as { seconds?: unknown; nanoseconds?: unknown };
    if (typeof ts?.seconds === 'number') {
        const millis = ts.seconds * 1000 + (typeof ts?.nanoseconds === 'number' ? Math.floor(ts.nanoseconds / 1_000_000) : 0);
        const d = new Date(millis);
        if (!Number.isNaN(d.getTime())) return d.toLocaleString();
    }
    const d = new Date(String(value));
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
};

export default function ResultsModal({ race, status, onClose, onRaceUpdate, embedded = false }: ResultsModalProps) {
    const { user } = useAuth();

    const verifications = useAdminVerifications({ user, raceId: race?.id });

    const email = useEmailComposer({
        user,
        usersByZwiftId: verifications.usersByZwiftId,
        drVerifications: verifications.drVerifications,
        raceResults: race?.results || {},
    });

    // ── DQ / DC / EX handlers ────────────────────────────────────────────────

    const handleToggleDQ = useCallback(async (zwiftId: string, isCurrentlyDQ: boolean) => {
        if (!race) return;
        try {
            const raceRef = doc(db, 'races', race.id);
            if (isCurrentlyDQ) {
                await updateDoc(raceRef, { manualDQs: arrayRemove(zwiftId) });
            } else {
                await updateDoc(raceRef, { manualDQs: arrayUnion(zwiftId), manualDeclassifications: arrayRemove(zwiftId) });
            }
            onRaceUpdate({
                ...race,
                manualDQs: isCurrentlyDQ ? (race.manualDQs || []).filter(id => id !== zwiftId) : [...(race.manualDQs || []), zwiftId],
                manualDeclassifications: isCurrentlyDQ ? race.manualDeclassifications : (race.manualDeclassifications || []).filter(id => id !== zwiftId),
            });
        } catch { alert('Failed to update DQ status'); }
    }, [race, onRaceUpdate]);

    const handleToggleDeclass = useCallback(async (zwiftId: string, isCurrentlyDeclass: boolean) => {
        if (!race) return;
        try {
            const raceRef = doc(db, 'races', race.id);
            if (isCurrentlyDeclass) {
                await updateDoc(raceRef, { manualDeclassifications: arrayRemove(zwiftId) });
            } else {
                await updateDoc(raceRef, { manualDeclassifications: arrayUnion(zwiftId), manualDQs: arrayRemove(zwiftId) });
            }
            onRaceUpdate({
                ...race,
                manualDeclassifications: isCurrentlyDeclass ? (race.manualDeclassifications || []).filter(id => id !== zwiftId) : [...(race.manualDeclassifications || []), zwiftId],
                manualDQs: isCurrentlyDeclass ? race.manualDQs : (race.manualDQs || []).filter(id => id !== zwiftId),
            });
        } catch { alert('Failed to update Declass status'); }
    }, [race, onRaceUpdate]);

    const handleToggleExclude = useCallback(async (zwiftId: string, isCurrentlyExcluded: boolean) => {
        if (!race) return;
        try {
            const raceRef = doc(db, 'races', race.id);
            if (isCurrentlyExcluded) {
                await updateDoc(raceRef, { manualExclusions: arrayRemove(zwiftId) });
            } else {
                await updateDoc(raceRef, { manualExclusions: arrayUnion(zwiftId), manualDQs: arrayRemove(zwiftId), manualDeclassifications: arrayRemove(zwiftId) });
            }
            onRaceUpdate({
                ...race,
                manualExclusions: isCurrentlyExcluded ? (race.manualExclusions || []).filter(id => id !== zwiftId) : [...(race.manualExclusions || []), zwiftId],
                manualDQs: isCurrentlyExcluded ? race.manualDQs : (race.manualDQs || []).filter(id => id !== zwiftId),
                manualDeclassifications: isCurrentlyExcluded ? race.manualDeclassifications : (race.manualDeclassifications || []).filter(id => id !== zwiftId),
            });
        } catch { alert('Failed to update exclusion status'); }
    }, [race, onRaceUpdate]);

    if (!race) return null;

    const results = race.results || {};
    const rankIndex = new Map<string, number>(CATEGORY_RANK.map((cat, idx) => [cat.toLowerCase(), idx]));
    let categories = Object.keys(results);

    if (race.eventMode === 'multi' && race.eventConfiguration) {
        const orderMap = new Map(race.eventConfiguration.map((cfg, idx) => [cfg.customCategory, idx]));
        categories.sort((a, b) => {
            const rA = rankIndex.get(a.toLowerCase()) ?? 999;
            const rB = rankIndex.get(b.toLowerCase()) ?? 999;
            if (rA !== rB) return rA - rB;
            return (orderMap.get(a) ?? 999) - (orderMap.get(b) ?? 999) || a.localeCompare(b);
        });
    } else {
        categories.sort((a, b) => (rankIndex.get(a.toLowerCase()) ?? 999) - (rankIndex.get(b.toLowerCase()) ?? 999) || a.localeCompare(b));
    }

    const content = (
        <div className={embedded
            ? 'bg-card w-full rounded-lg shadow border border-border flex flex-col'
            : 'bg-card w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-lg shadow-2xl border border-border flex flex-col'
        }>
            <div className="p-4 border-b border-border bg-muted/30 space-y-3">
                <div className="flex justify-between items-start gap-3">
                    <div>
                        <h3 className="text-lg font-bold text-card-foreground">Results: {race.name}</h3>
                        {race.date && <p className="text-xs text-muted-foreground mt-0.5">{formatDisplayDate(race.date)}</p>}
                    </div>
                    {!embedded && (
                        <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">✕</button>
                    )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        onClick={email.openComposeForBulkDR}
                        className="text-sm bg-primary text-primary-foreground px-3 py-1.5 rounded hover:opacity-90 disabled:opacity-60"
                        disabled={email.drBulkRecipients.length === 0}
                    >
                        Email alle DR-ryttere
                    </button>
                    <span className="text-xs text-muted-foreground">{email.drBulkRecipients.length} DR-ryttere i dette løb</span>
                </div>
                {email.sendStatus && (
                    <p className={`text-xs ${email.sendStatus.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                        {email.sendStatus.text}
                    </p>
                )}
            </div>

            <div className={`${embedded ? 'p-4' : 'overflow-y-auto p-4'} space-y-6`}>
                {categories.length === 0 ? (
                    <div className="text-center text-muted-foreground p-8">No results calculated yet.</div>
                ) : (
                    <>
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

                        {categories.map(cat => (
                            <CategoryResultsTable
                                key={cat}
                                category={cat}
                                results={results[cat] as RaceResult[]}
                                manualDQs={race.manualDQs || []}
                                manualDeclassifications={race.manualDeclassifications || []}
                                manualExclusions={race.manualExclusions || []}
                                drVerifications={verifications.drVerifications}
                                usersByZwiftId={verifications.usersByZwiftId}
                                weightVerifications={verifications.weightVerifications}
                                onToggleDQ={handleToggleDQ}
                                onToggleDeclass={handleToggleDeclass}
                                onToggleExclude={handleToggleExclude}
                                onOpenDR={verifications.openDrModal}
                                onOpenEmail={email.openComposeForIndividual}
                            />
                        ))}
                    </>
                )}
            </div>
        </div>
    );

    return (
        <>
            {embedded ? content : (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    {content}
                </div>
            )}
            {verifications.drModal && (
                <DualRecordingResultModal
                    open
                    onClose={() => verifications.setDrModal(null)}
                    riderName={verifications.drModal.name}
                    verification={verifications.drModal.verification}
                    onRunForRider={verifications.handleRunSingleDR}
                    runForRiderBusy={verifications.singleDrRunning}
                    runForRiderStatus={verifications.singleDrStatus}
                    streamResult={verifications.drDetailResult}
                    streamLoading={verifications.drDetailLoading}
                    streamError={verifications.drDetailError}
                />
            )}
            <ComposeEmailModal
                isOpen={email.isComposeOpen}
                title={email.composeTitle}
                subject={email.emailSubject}
                onSubjectChange={email.setEmailSubject}
                onMessageChange={email.setEmailMessage}
                initialMessage={email.emailMessage}
                onClose={email.closeComposeModal}
                onSend={email.handleSendEmail}
                sending={email.sendingEmail}
                sendDisabled={email.composeRecipients.length === 0}
                sendLabel="Send email"
                sendingLabel="Sender..."
                error={email.sendError}
                beforeSubject={(
                    <EmailRecipientControls
                        recipientsOpen={email.recipientsOpen}
                        onToggleOpen={() => email.setRecipientsOpen(open => !open)}
                        recipients={email.composeRecipientItems}
                        selectedCount={email.composeRecipients.length}
                        selectedWithoutEmail={email.selectedWithoutEmail}
                        sendMode={email.sendMode}
                        onSendModeChange={email.setSendMode}
                        recipientMode={email.recipientMode}
                        onRecipientModeChange={email.setRecipientMode}
                        manualTo={email.manualTo}
                        manualCc={email.manualCc}
                        manualBcc={email.manualBcc}
                        manualToCount={email.parseManualEmails(email.manualTo).valid.length || '...'}
                        manualCcCount={email.parseManualEmails(email.manualCc).valid.length || '...'}
                        manualBccCount={email.parseManualEmails(email.manualBcc).valid.length || '...'}
                        toError={email.toError}
                        ccError={email.ccError}
                        bccError={email.bccError}
                        onManualToChange={email.setManualTo}
                        onManualCcChange={email.setManualCc}
                        onManualBccChange={email.setManualBcc}
                        sending={email.sendingEmail}
                    />
                )}
            />
        </>
    );
}

// ── CategoryResultsTable ─────────────────────────────────────────────────────

interface CategoryResultsTableProps {
    category: string;
    results: RaceResult[];
    manualDQs: string[];
    manualDeclassifications: string[];
    manualExclusions: string[];
    drVerifications: Map<string, DualRecordingVerification>;
    usersByZwiftId: Map<string, { userId: string; zwiftId: string; name: string; email: string; trainer?: string }>;
    weightVerifications: Map<string, WeightVerificationRecord>;
    onToggleDQ: (zwiftId: string, isCurrentlyDQ: boolean) => void;
    onToggleDeclass: (zwiftId: string, isCurrentlyDeclass: boolean) => void;
    onToggleExclude: (zwiftId: string, isCurrentlyExcluded: boolean) => void;
    onOpenDR: (riderName: string, zwiftId: string, activityId: string | undefined, v: DualRecordingVerification) => void;
    onOpenEmail: (rider: RaceResult) => void;
}

function CategoryResultsTable({
    category, results, manualDQs, manualDeclassifications, manualExclusions,
    drVerifications, usersByZwiftId, weightVerifications,
    onToggleDQ, onToggleDeclass, onToggleExclude, onOpenDR, onOpenEmail,
}: CategoryResultsTableProps) {
    return (
        <div className="border border-border rounded-lg overflow-hidden">
            <div className="bg-secondary/50 px-4 py-2 font-semibold text-sm border-b border-border">{category}</div>
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
                        <th className="px-4 py-2 text-center w-14" title="Weight Verification">WV</th>
                        <th className="px-4 py-2 text-center w-14" title="Sticky Watts">SW</th>
                        <th className="px-4 py-2 text-center w-12" title="Disqualify (0 pts)">DQ</th>
                        <th className="px-4 py-2 text-center w-12" title="Declassify (Last place pts)">DC</th>
                        <th className="px-4 py-2 text-center w-12" title="Exclude from results">EX</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-border">
                    {results.map((rider, idx) => {
                        const zwiftId = String(rider.zwiftId);
                        const isFlagged = rider.flaggedCheating || rider.flaggedSandbagging;
                        const isDQ = manualDQs.includes(zwiftId);
                        const isDC = manualDeclassifications.includes(zwiftId);
                        const isEX = manualExclusions.includes(zwiftId);
                        const raceStatus = String(rider.raceStatus || (rider.finishTime > 0 ? 'FIN' : 'DNF')).toUpperCase();
                        const statusLabel = isEX ? 'EX' : isDQ ? 'DQ' : isDC ? 'DC' : raceStatus;
                        const hidePoints = statusLabel === 'DNF' || statusLabel === 'EX';

                        let rowClass = 'hover:bg-muted/10';
                        if (isEX) rowClass += ' bg-slate-50 dark:bg-slate-900/30';
                        else if (isFlagged || isDQ) rowClass += ' bg-red-50 dark:bg-red-950/20';
                        else if (isDC) rowClass += ' bg-yellow-50 dark:bg-yellow-950/20';

                        return (
                            <tr key={zwiftId} className={rowClass}>
                                <td className="px-4 py-2 text-muted-foreground">
                                    {isEX ? '×' : isDQ ? '-' : isDC ? '*' : idx + 1}
                                </td>
                                <td className="px-4 py-2 font-medium">
                                    {rider.name}
                                    {isFlagged && <div className="text-[10px] text-red-600 font-bold mt-0.5">{rider.flaggedCheating ? 'CHEATING ' : ''}{rider.flaggedSandbagging ? 'SANDBAGGING' : ''}</div>}
                                    {isEX && <div className="text-[10px] text-slate-600 font-bold mt-0.5">EXCLUDED</div>}
                                    {isDQ && <div className="text-[10px] text-red-600 font-bold mt-0.5">DISQUALIFIED</div>}
                                    {isDC && <div className="text-[10px] text-yellow-600 font-bold mt-0.5">DECLASSIFIED</div>}
                                    <button type="button" onClick={() => onOpenEmail(rider)} className="mt-1 inline-flex text-[11px] px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40">
                                        Email
                                    </button>
                                </td>
                                <td className="px-4 py-2 text-center font-semibold text-muted-foreground">{statusLabel}</td>
                                <td className="px-4 py-2 text-center font-mono text-muted-foreground">
                                    {rider.finishTime > 0 ? new Date(rider.finishTime).toISOString().substr(11, 8) : 'DNF'}
                                </td>
                                <td className="px-4 py-2 text-right font-bold text-primary">
                                    {hidePoints ? '-' : rider.totalPoints}
                                    {(isEX || (isDQ && rider.totalPoints > 0) || (isDC && rider.totalPoints === 0)) && (
                                        <span className="text-[10px] text-red-500 block" title="Recalculation needed">(Recalc)</span>
                                    )}
                                </td>
                                <td className="px-4 py-2 text-center">
                                    {isFlagged ? <span className="text-xl" title="Flagged">🚩</span> : <span className="text-muted-foreground">-</span>}
                                </td>
                                <td className="px-4 py-2 text-center">
                                    {drVerifications.has(zwiftId) ? (
                                        <DualRecordingStatusBadge
                                            verification={drVerifications.get(zwiftId)}
                                            onClick={() => onOpenDR(rider.name, zwiftId, rider.activityId, drVerifications.get(zwiftId)!)}
                                        />
                                    ) : <span className="text-muted-foreground">-</span>}
                                </td>
                                <td className="px-4 py-2 text-center">
                                    {weightVerifications.has(zwiftId) ? (
                                        <WeightVerificationStatusBadge verification={weightVerifications.get(zwiftId)} />
                                    ) : <span className="text-muted-foreground">-</span>}
                                </td>
                                <td className="px-4 py-2 text-center">
                                    <StickyWattsStatusBadge
                                        stickyWatts={drVerifications.get(zwiftId)?.stickyWatts}
                                        trainerName={drVerifications.get(zwiftId)?.trainerName || usersByZwiftId.get(zwiftId)?.trainer}
                                    />
                                </td>
                                <td className="px-4 py-2 text-center">
                                    <input type="checkbox" checked={isDQ} onChange={() => onToggleDQ(zwiftId, isDQ)} disabled={isDC || isEX}
                                        title={isEX ? 'Excluded from results' : isDC ? 'Uncheck Declassify first' : 'Disqualify'}
                                        className="w-4 h-4 rounded border-input text-primary focus:ring-primary cursor-pointer disabled:opacity-30" />
                                </td>
                                <td className="px-4 py-2 text-center">
                                    <input type="checkbox" checked={isDC} onChange={() => onToggleDeclass(zwiftId, isDC)} disabled={isDQ || isEX}
                                        title={isEX ? 'Excluded from results' : isDQ ? 'Uncheck DQ first' : 'Declassify'}
                                        className="w-4 h-4 rounded border-input text-yellow-500 focus:ring-yellow-500 cursor-pointer disabled:opacity-30" />
                                </td>
                                <td className="px-4 py-2 text-center">
                                    <input type="checkbox" checked={isEX} onChange={() => onToggleExclude(zwiftId, isEX)}
                                        title={isEX ? 'Include in results' : 'Exclude from results'}
                                        className="w-4 h-4 rounded border-input text-slate-600 focus:ring-slate-500 cursor-pointer" />
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
