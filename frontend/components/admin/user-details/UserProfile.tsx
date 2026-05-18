'use client';

import { UserDetail } from './types';
import { fmtDate, fmtDateTime, SectionCard, Row, Badge, cpLabel } from './shared';

export interface UserProfileProps {
    detail: UserDetail;
}

export default function UserProfile({ detail }: UserProfileProps) {
    return (
        <>
            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-foreground">{detail.basic.name}</h2>
                    <p className="text-muted-foreground text-sm mt-0.5">{detail.basic.email}</p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                    <div>Zwift ID: <span className="font-mono">{detail.basic.zwiftId}</span></div>
                    <div>Member since: {fmtDate(detail.registration.dataPolicy?.acceptedAt)}</div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">

                {/* Basic Info */}
                <SectionCard title="Basic Info">
                    <Row label="Name" value={detail.basic.name} />
                    <Row label="Email" value={detail.basic.email} />
                    <Row label="Zwift ID" value={<span className="font-mono">{detail.basic.zwiftId}</span>} />
                    <Row label="Club" value={detail.basic.club || '—'} />
                    <Row label="Trainer" value={detail.basic.trainer || '—'} />
                    <Row label="Created" value={fmtDate(detail.basic.createdAt)} />
                    <Row label="Updated" value={fmtDateTime(detail.basic.updatedAt)} />
                </SectionCard>

                {/* Racing Stats */}
                <SectionCard title="Racing Stats">
                    <Row label="vELO (current)" value={detail.zwiftRacing?.currentRating != null ? Number(detail.zwiftRacing.currentRating).toFixed(0) : '—'} />
                    <Row label="vELO (max 30d)" value={detail.zwiftRacing?.max30Rating != null ? Number(detail.zwiftRacing.max30Rating).toFixed(0) : '—'} />
                    <Row label="vELO (max 90d)" value={detail.zwiftRacing?.max90Rating != null ? Number(detail.zwiftRacing.max90Rating).toFixed(0) : '—'} />
                    <Row label="Phenotype" value={<span className="capitalize">{detail.zwiftRacing?.phenotype || '—'}</span>} />
                    <Row label="Racing Score" value={detail.zwiftProfile?.racingScore != null ? detail.zwiftProfile.racingScore : '—'} />
                    <Row label="Updated" value={fmtDateTime(detail.zwiftRacing?.updatedAt)} />
                </SectionCard>

                {/* Zwift Profile */}
                {detail.zwiftProfile && (
                    <SectionCard title="Zwift Profile">
                        <Row label="FTP" value={detail.zwiftProfile.ftp != null ? `${detail.zwiftProfile.ftp}W` : '—'} />
                        <Row label="ZFTP" value={detail.zwiftProfile.zftp != null ? `${detail.zwiftProfile.zftp}W` : '—'} />
                        <Row label="ZMAP" value={detail.zwiftProfile.zmap != null ? `${detail.zwiftProfile.zmap}W` : '—'} />
                        <Row label="VO2max" value={detail.zwiftProfile.vo2max != null ? detail.zwiftProfile.vo2max : '—'} />
                        <Row label="Weight" value={detail.zwiftProfile.weightInGrams != null ? `${(detail.zwiftProfile.weightInGrams / 1000).toFixed(1)} kg` : '—'} />
                        <Row label="Height" value={detail.zwiftProfile.height != null ? `${detail.zwiftProfile.height} cm` : '—'} />
                        <Row label="Power Compound" value={detail.zwiftProfile.powerCompoundScore != null ? detail.zwiftProfile.powerCompoundScore : '—'} />
                        <Row label="Zwift Category" value={detail.zwiftProfile.category || '—'} />
                        <Row label="Updated" value={fmtDateTime(detail.zwiftProfile.updatedAt)} />
                    </SectionCard>
                )}

                {/* Connections */}
                <SectionCard title="Connections">
                    <div className="pt-1 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Zwift</div>
                    <Row label="Connected" value={detail.connections.zwift.connected ? '✓ Yes' : '✗ No'} />
                    {detail.connections.zwift.profileId && (
                        <Row label="Profile ID" value={<span className="font-mono text-xs">{detail.connections.zwift.profileId}</span>} />
                    )}
                    <Row label="Connected at" value={fmtDateTime(detail.connections.zwift.connectedAt)} />
                    <div className="pt-2 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Strava</div>
                    <Row label="Connected" value={detail.connections.strava.connected ? '✓ Yes' : '✗ No'} />
                    {detail.connections.strava.athleteId && (
                        <Row label="Athlete ID" value={<span className="font-mono text-xs">{detail.connections.strava.athleteId}</span>} />
                    )}
                </SectionCard>

                {/* Registration */}
                <SectionCard title="Registration">
                    <Row label="Status" value={detail.registration.status || '—'} />
                    <Row label="CoC accepted" value={detail.registration.cocAccepted ? '✓ Yes' : '✗ No'} />
                    {detail.registration.dataPolicy && (
                        <>
                            <Row label="Data policy ver." value={detail.registration.dataPolicy.version || '—'} />
                            <Row label="Data policy accepted" value={fmtDate(detail.registration.dataPolicy.acceptedAt)} />
                        </>
                    )}
                    {detail.registration.publicResultsConsent && (
                        <>
                            <Row label="Public results ver." value={detail.registration.publicResultsConsent.version || '—'} />
                            <Row label="Public results accepted" value={fmtDate(detail.registration.publicResultsConsent.acceptedAt)} />
                        </>
                    )}
                </SectionCard>

            </div>

            {/* Power Curve */}
            {detail.zwiftPowerCurve && (detail.zwiftPowerCurve.cpBestEfforts?.length ?? 0) > 0 && (
                <SectionCard title="Power Curve">
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
                        {detail.zwiftPowerCurve.cpBestEfforts!.map((cp, i) => (
                            <div key={i} className="bg-muted/40 rounded-lg p-3 text-center">
                                <div className="text-xs text-muted-foreground mb-1">{cpLabel(cp.duration)}</div>
                                <div className="text-lg font-bold text-foreground">{cp.watts}W</div>
                                {cp.wattsPerKg != null && (
                                    <div className="text-xs text-muted-foreground">{cp.wattsPerKg.toFixed(2)} w/kg</div>
                                )}
                            </div>
                        ))}
                    </div>
                    {detail.zwiftPowerCurve.updatedAt && (
                        <p className="text-xs text-muted-foreground mt-3">Updated: {fmtDateTime(detail.zwiftPowerCurve.updatedAt)}</p>
                    )}
                </SectionCard>
            )}
        </>
    );
}
