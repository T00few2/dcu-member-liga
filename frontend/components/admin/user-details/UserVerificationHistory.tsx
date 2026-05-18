'use client';

import { useState } from 'react';
import { UserDetail, RaceEntry } from './types';
import { fmtDate, fmtDateTime, fmtFinishTime, fmtDuration, SectionCard, Row, Badge, CATEGORY_STYLES, VERIFICATION_STYLES, cpLabel } from './shared';

// ── Race status flags ──────────────────────────────────────────────────────────

function RaceFlags({ race }: { race: RaceEntry }) {
    const flags: string[] = [];
    if (race.disqualified) flags.push('DQ');
    if (race.declassified) flags.push('Declassified');
    if (race.flaggedSandbagging) flags.push('Sandbagging');
    if (race.flaggedCheating) flags.push('Cheating');
    if (!flags.length) return null;
    return (
        <div className="flex gap-1 flex-wrap">
            {flags.map(f => (
                <span key={f} className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">{f}</span>
            ))}
        </div>
    );
}

// ── Expandable race row ────────────────────────────────────────────────────────

function RaceRow({ race }: { race: RaceEntry }) {
    const [expanded, setExpanded] = useState(false);

    const sprintSegments = Object.entries(race.sprintData ?? {});
    const cpEntries = Object.entries(race.criticalP ?? {})
        .map(([k, v]) => ({ duration: Number(k), watts: v }))
        .filter(e => !isNaN(e.duration))
        .sort((a, b) => a.duration - b.duration);

    const hasDetail = sprintSegments.length > 0 || cpEntries.length > 0;

    const statusLabel = race.raceStatus === 'FIN' ? 'FIN'
        : race.raceStatus === 'DNF' ? 'DNF'
        : race.raceStatus || '—';

    return (
        <>
            <tr
                className={`border-b border-border/50 hover:bg-muted/30 transition${hasDetail ? ' cursor-pointer' : ''}`}
                onClick={hasDetail ? () => setExpanded(e => !e) : undefined}
            >
                <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{race.date || '—'}</td>
                <td className="px-3 py-2 text-sm font-medium">
                    <div>{race.name || '—'}</div>
                    <div className="text-xs text-muted-foreground">
                        {[race.map, race.archive].filter(Boolean).join(' · ')}
                    </div>
                </td>
                <td className="px-3 py-2 text-center">
                    {race.category ? (
                        <Badge label={race.category} className={CATEGORY_STYLES[race.category] ?? 'bg-gray-100 text-gray-700'} />
                    ) : '—'}
                </td>
                <td className="px-3 py-2 text-center font-mono text-xs">
                    {race.finishRank && race.finishRank > 0 ? `#${race.finishRank}` : '—'}
                </td>
                <td className="px-3 py-2 text-center font-mono text-xs">{fmtFinishTime(race.finishTime)}</td>
                <td className="px-3 py-2 text-center font-mono text-xs">{race.finishPoints ?? '—'}</td>
                <td className="px-3 py-2 text-center font-mono text-xs">{race.sprintPoints ?? '—'}</td>
                <td className="px-3 py-2 text-center font-mono text-xs font-semibold">{race.totalPoints ?? '—'}</td>
                <td className="px-3 py-2 text-center">
                    <div className="flex flex-col items-center gap-1">
                        <span className={`text-xs font-medium ${statusLabel === 'DNF' ? 'text-orange-600' : 'text-muted-foreground'}`}>
                            {statusLabel}
                        </span>
                        <RaceFlags race={race} />
                    </div>
                </td>
                {hasDetail && (
                    <td className="px-3 py-2 text-center text-muted-foreground text-xs">
                        {expanded ? '▲' : '▼'}
                    </td>
                )}
                {!hasDetail && <td />}
            </tr>
            {expanded && hasDetail && (
                <tr className="bg-muted/20 border-b border-border/50">
                    <td colSpan={10} className="px-4 py-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {sprintSegments.length > 0 && (
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Sprint Segments</p>
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="text-muted-foreground">
                                                <th className="text-left pb-1">Segment</th>
                                                <th className="text-right pb-1">Rank</th>
                                                <th className="text-right pb-1">Avg Power</th>
                                                <th className="text-right pb-1">Time</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {sprintSegments.map(([seg, sd]) => (
                                                <tr key={seg} className="border-t border-border/30">
                                                    <td className="py-0.5 font-medium">{seg}</td>
                                                    <td className="py-0.5 text-right">{sd.rank && sd.rank > 0 ? `#${sd.rank}` : '—'}</td>
                                                    <td className="py-0.5 text-right">{sd.avgPower ? `${sd.avgPower}W` : '—'}</td>
                                                    <td className="py-0.5 text-right">{fmtDuration(sd.time)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                            {cpEntries.length > 0 && (
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Critical Power</p>
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="text-muted-foreground">
                                                <th className="text-left pb-1">Duration</th>
                                                <th className="text-right pb-1">Watts</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {cpEntries.map(({ duration, watts }) => (
                                                <tr key={duration} className="border-t border-border/30">
                                                    <td className="py-0.5 font-medium">{cpLabel(duration)}</td>
                                                    <td className="py-0.5 text-right">{watts}W</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}

// ── Props ──────────────────────────────────────────────────────────────────────

export interface UserVerificationHistoryProps {
    verification: UserDetail['verification'];
    races: RaceEntry[];
    loadingRaces: boolean;
}

export default function UserVerificationHistory({
    verification,
    races,
    loadingRaces,
}: UserVerificationHistoryProps) {
    return (
        <>
            {/* Verification */}
            <SectionCard title="Verification">
                <Row label="Status" value={
                    <Badge
                        label={verification.status}
                        className={VERIFICATION_STYLES[verification.status] ?? 'bg-gray-100 text-gray-600'}
                    />
                } />
                {verification.currentRequest && (
                    <>
                        <div className="pt-2 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Current request</div>
                        <Row label="Type" value={verification.currentRequest.type || '—'} />
                        <Row label="Requested" value={fmtDate(verification.currentRequest.requestedAt)} />
                        <Row label="Deadline" value={fmtDate(verification.currentRequest.deadline)} />
                        <Row label="Submitted" value={fmtDateTime(verification.currentRequest.submittedAt)} />
                        <Row label="Reviewed" value={fmtDateTime(verification.currentRequest.reviewedAt)} />
                        {verification.currentRequest.videoLink && (
                            <Row label="Video" value={
                                <a href={verification.currentRequest.videoLink} target="_blank" rel="noopener noreferrer" className="text-primary underline text-xs truncate max-w-48 block">
                                    View video
                                </a>
                            } />
                        )}
                        {verification.currentRequest.rejectionReason && (
                            <Row label="Rejection reason" value={verification.currentRequest.rejectionReason} />
                        )}
                    </>
                )}
                {verification.history.length > 0 && (
                    <>
                        <div className="pt-2 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">History ({verification.history.length})</div>
                        <div className="space-y-2 mt-1">
                            {verification.history.map((h, i) => (
                                <div key={i} className="text-xs bg-muted/40 rounded p-2">
                                    <div className="flex justify-between">
                                        <span className="font-medium capitalize">{h.status || 'unknown'}</span>
                                        <span className="text-muted-foreground">{fmtDate(h.requestedAt)}</span>
                                    </div>
                                    {h.rejectionReason && <div className="text-red-600 mt-0.5">{h.rejectionReason}</div>}
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </SectionCard>

            {/* Race History */}
            <SectionCard title={`Race History${races.length > 0 ? ` (${races.length})` : ''}`}>
                {loadingRaces ? (
                    <div className="text-sm text-muted-foreground py-4 text-center">Loading races…</div>
                ) : races.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-4 text-center">No races found.</div>
                ) : (
                    <div className="overflow-x-auto -mx-5 px-5">
                        <table className="w-full text-sm min-w-[700px]">
                            <thead>
                                <tr className="text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b border-border">
                                    <th className="px-3 py-2 text-left">Date</th>
                                    <th className="px-3 py-2 text-left">Race</th>
                                    <th className="px-3 py-2 text-center">Cat.</th>
                                    <th className="px-3 py-2 text-center">Rank</th>
                                    <th className="px-3 py-2 text-center">Time</th>
                                    <th className="px-3 py-2 text-center">Finish pts</th>
                                    <th className="px-3 py-2 text-center">Sprint pts</th>
                                    <th className="px-3 py-2 text-center">Total pts</th>
                                    <th className="px-3 py-2 text-center">Status</th>
                                    <th className="px-3 py-2" />
                                </tr>
                            </thead>
                            <tbody>
                                {races.map(race => (
                                    <RaceRow key={`${race.raceId}-${race.category}`} race={race} />
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </SectionCard>
        </>
    );
}
