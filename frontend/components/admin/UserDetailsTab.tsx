'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';

// ── Types ──────────────────────────────────────────────────────────────────────

interface UserSearchRow {
    userId: string;
    zwiftId: string;
    name: string;
    email: string;
    club: string;
}

interface VerificationRequest {
    requestId?: string;
    type?: string;
    status?: string;
    requestedAt?: number | null;
    deadline?: number | null;
    videoLink?: string | null;
    submittedAt?: number | null;
    reviewedAt?: number | null;
    reviewerId?: string | null;
    rejectionReason?: string | null;
}

interface UserDetail {
    userId: string;
    basic: {
        name: string;
        email: string;
        zwiftId: string;
        club: string;
        trainer: string;
        createdAt?: number | null;
        updatedAt?: number | null;
    };
    zwiftProfile?: {
        ftp?: number | null;
        zftp?: number | null;
        zmap?: number | null;
        weight?: number | null;
        weightInGrams?: number | null;
        height?: number | null;
        racingScore?: number | null;
        powerCompoundScore?: number | null;
        vo2max?: number | null;
        category?: string | null;
        updatedAt?: number | null;
    } | null;
    zwiftPowerCurve?: {
        zftp?: number | null;
        zmap?: number | null;
        vo2max?: number | null;
        validPowerProfile?: boolean | null;
        cpBestEfforts?: Array<{ duration: number; watts: number; wattsPerKg?: number }>;
        relevantCpEfforts?: Array<{ duration: number; watts: number; wattsPerKg?: number }>;
        updatedAt?: number | null;
    } | null;
    zwiftRacing?: {
        currentRating?: number | null;
        max30Rating?: number | null;
        max90Rating?: number | null;
        phenotype?: string | null;
        updatedAt?: number | null;
    } | null;
    connections: {
        zwift: { connected: boolean; connectedAt?: number | null; profileId?: string | null; userId?: string | null };
        strava: { connected: boolean; athleteId?: number | string | null };
    };
    ligaCategory: {
        category?: string | null;
        locked: boolean;
        lockedAt?: number | null;
        autoAssigned?: {
            season?: string | null;
            category?: string | null;
            upperBoundary?: number | null;
            graceLimit?: number | null;
            status?: string | null;
            assignedRating?: number | null;
            assignedAt?: number | null;
            lastCheckedRating?: number | null;
            lastCheckedAt?: number | null;
        } | null;
        selfSelected?: {
            category?: string | null;
            selfSelectedAt?: number | null;
        } | null;
    };
    verification: {
        status: string;
        currentRequest?: VerificationRequest | null;
        history: VerificationRequest[];
    };
    registration: {
        status?: string | null;
        cocAccepted: boolean;
        dataPolicy?: { version?: string | null; acceptedAt?: number | null } | null;
        publicResultsConsent?: { version?: string | null; acceptedAt?: number | null } | null;
    };
}

interface RaceEntry {
    raceId: string;
    name: string;
    date: string;
    map: string;
    category: string;
    finishTime?: number | null;
    finishRank?: number | null;
    finishPoints?: number | null;
    sprintPoints?: number | null;
    totalPoints?: number | null;
    raceStatus?: string;
    disqualified: boolean;
    declassified: boolean;
    flaggedSandbagging: boolean;
    flaggedCheating: boolean;
    activityId?: string | null;
    sprintData?: Record<string, { time?: number; avgPower?: number; rank?: number }>;
    sprintDetails?: Record<string, number | string>;
    criticalP?: Record<string, number>;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

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

function fmtDate(ms?: number | null) {
    if (!ms) return '—';
    return new Date(ms).toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(ms?: number | null) {
    if (!ms) return '—';
    return new Date(ms).toLocaleString('en-IE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtFinishTime(ms?: number | null) {
    if (!ms || ms === 0) return 'DNF';
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtDuration(ms?: number) {
    if (!ms) return '—';
    const totalSec = Math.floor(ms / 1000);
    if (totalSec < 60) return `${totalSec}s`;
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function Badge({ label, className }: { label: string; className?: string }) {
    return (
        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${className ?? 'bg-gray-100 text-gray-700'}`}>
            {label}
        </span>
    );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">{title}</h3>
            {children}
        </div>
    );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="flex justify-between items-start gap-4 py-1.5 border-b border-border/50 last:border-0">
            <span className="text-sm text-muted-foreground shrink-0">{label}</span>
            <span className="text-sm text-foreground text-right">{value ?? '—'}</span>
        </div>
    );
}

// ── CP duration labels ─────────────────────────────────────────────────────────

const CP_LABELS: Record<number, string> = {
    5: '5s', 10: '10s', 20: '20s', 30: '30s',
    60: '1min', 120: '2min', 300: '5min',
    600: '10min', 720: '12min', 1200: '20min',
    1800: '30min', 3600: '60min',
};

function cpLabel(duration: number) {
    return CP_LABELS[duration] ?? `${duration}s`;
}

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
                    {race.map && <div className="text-xs text-muted-foreground">{race.map}</div>}
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

// ── Main component ─────────────────────────────────────────────────────────────

interface UserDetailsTabProps {
    initialUserId: string | null;
    onUserSelect: (userId: string) => void;
}

export default function UserDetailsTab({ initialUserId, onUserSelect }: UserDetailsTabProps) {
    const { user: authUser } = useAuth();

    // Search
    const [searchQuery, setSearchQuery] = useState('');
    const [allUsers, setAllUsers] = useState<UserSearchRow[]>([]);
    const [showDropdown, setShowDropdown] = useState(false);
    const searchRef = useRef<HTMLDivElement>(null);

    // Selected user data
    const [selectedId, setSelectedId] = useState<string | null>(initialUserId);
    const [detail, setDetail] = useState<UserDetail | null>(null);
    const [races, setRaces] = useState<RaceEntry[]>([]);
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [loadingRaces, setLoadingRaces] = useState(false);
    const [detailError, setDetailError] = useState<string | null>(null);

    // Sync with URL-driven prop
    useEffect(() => {
        setSelectedId(initialUserId);
    }, [initialUserId]);

    // Fetch user list for search
    useEffect(() => {
        if (!authUser) return;
        authUser.getIdToken().then(token => {
            fetch(`${API_URL}/admin/users`, { headers: { Authorization: `Bearer ${token}` } })
                .then(r => r.json())
                .then(data => {
                    if (data.users) setAllUsers(data.users);
                })
                .catch(() => {});
        });
    }, [authUser]);

    // Fetch full detail when selectedId changes
    const fetchDetail = useCallback(async (userId: string) => {
        if (!authUser) return;
        setLoadingDetail(true);
        setLoadingRaces(true);
        setDetailError(null);
        setDetail(null);
        setRaces([]);

        try {
            const token = await authUser.getIdToken();
            const headers = { Authorization: `Bearer ${token}` };

            const [detailRes, racesRes] = await Promise.all([
                fetch(`${API_URL}/admin/users/${encodeURIComponent(userId)}`, { headers }),
                fetch(`${API_URL}/admin/users/${encodeURIComponent(userId)}/races`, { headers }),
            ]);

            const detailData = await detailRes.json();
            const racesData = await racesRes.json();

            if (!detailRes.ok) {
                setDetailError(detailData.error ?? 'Failed to load user details');
            } else {
                setDetail(detailData.user);
            }
            if (racesRes.ok && racesData.races) {
                setRaces(racesData.races);
            }
        } catch {
            setDetailError('Network error loading user details');
        } finally {
            setLoadingDetail(false);
            setLoadingRaces(false);
        }
    }, [authUser]);

    useEffect(() => {
        if (selectedId) fetchDetail(selectedId);
    }, [selectedId, fetchDetail]);

    // Search filtering
    const q = searchQuery.trim().toLowerCase();
    const filtered = q.length >= 1
        ? allUsers.filter(u =>
            u.name.toLowerCase().includes(q) ||
            u.email.toLowerCase().includes(q) ||
            u.zwiftId.toLowerCase().includes(q)
        ).slice(0, 10)
        : [];

    // Close dropdown on outside click
    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
                setShowDropdown(false);
            }
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    function selectUser(u: UserSearchRow) {
        setSearchQuery('');
        setShowDropdown(false);
        setSelectedId(u.userId);
        onUserSelect(u.userId);
    }

    return (
        <div className="space-y-6">
            {/* Search */}
            <div ref={searchRef} className="relative max-w-md">
                <label className="block text-sm font-medium text-foreground mb-1">Find user</label>
                <input
                    type="text"
                    value={searchQuery}
                    onChange={e => { setSearchQuery(e.target.value); setShowDropdown(true); }}
                    onFocus={() => setShowDropdown(true)}
                    placeholder="Search by name, email or Zwift ID…"
                    className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                {showDropdown && filtered.length > 0 && (
                    <div className="absolute z-50 mt-1 w-full bg-card border border-border rounded-lg shadow-lg overflow-hidden">
                        {filtered.map(u => (
                            <button
                                key={u.userId}
                                className="w-full text-left px-4 py-2.5 hover:bg-muted/60 transition border-b border-border/50 last:border-0"
                                onMouseDown={e => { e.preventDefault(); selectUser(u); }}
                            >
                                <div className="text-sm font-medium">{u.name}</div>
                                <div className="text-xs text-muted-foreground">{u.email} · {u.zwiftId}</div>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Empty state */}
            {!selectedId && !loadingDetail && (
                <div className="text-center py-16 text-muted-foreground">
                    <p className="text-lg mb-1">No user selected</p>
                    <p className="text-sm">Search above or click a row in the Overview tab.</p>
                </div>
            )}

            {/* Loading */}
            {loadingDetail && (
                <div className="text-center py-16 text-muted-foreground">Loading user details…</div>
            )}

            {/* Error */}
            {detailError && !loadingDetail && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
                    {detailError}
                </div>
            )}

            {/* Detail view */}
            {detail && !loadingDetail && (
                <div className="space-y-5">

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

                        {/* Liga Category */}
                        <SectionCard title="Liga Category">
                            <Row label="Effective category" value={
                                detail.ligaCategory.category ? (
                                    <Badge label={detail.ligaCategory.category} className={CATEGORY_STYLES[detail.ligaCategory.category] ?? 'bg-gray-100 text-gray-700'} />
                                ) : '—'
                            } />
                            <Row label="Locked" value={detail.ligaCategory.locked ? `Yes (${fmtDate(detail.ligaCategory.lockedAt)})` : 'No'} />
                            {detail.ligaCategory.autoAssigned && (
                                <>
                                    <div className="pt-2 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Auto-assigned</div>
                                    <Row label="Category" value={detail.ligaCategory.autoAssigned.category || '—'} />
                                    <Row label="Season" value={detail.ligaCategory.autoAssigned.season || '—'} />
                                    <Row label="Status" value={detail.ligaCategory.autoAssigned.status || '—'} />
                                    <Row label="Assigned rating" value={detail.ligaCategory.autoAssigned.assignedRating != null ? Number(detail.ligaCategory.autoAssigned.assignedRating).toFixed(0) : '—'} />
                                    <Row label="Last checked" value={fmtDate(detail.ligaCategory.autoAssigned.lastCheckedAt)} />
                                </>
                            )}
                            {detail.ligaCategory.selfSelected?.category && (
                                <>
                                    <div className="pt-2 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Self-selected</div>
                                    <Row label="Category" value={detail.ligaCategory.selfSelected.category} />
                                    <Row label="Selected" value={fmtDate(detail.ligaCategory.selfSelected.selfSelectedAt)} />
                                </>
                            )}
                        </SectionCard>

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

                        {/* Verification */}
                        <SectionCard title="Verification">
                            <Row label="Status" value={
                                <Badge
                                    label={detail.verification.status}
                                    className={VERIFICATION_STYLES[detail.verification.status] ?? 'bg-gray-100 text-gray-600'}
                                />
                            } />
                            {detail.verification.currentRequest && (
                                <>
                                    <div className="pt-2 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Current request</div>
                                    <Row label="Type" value={detail.verification.currentRequest.type || '—'} />
                                    <Row label="Requested" value={fmtDate(detail.verification.currentRequest.requestedAt)} />
                                    <Row label="Deadline" value={fmtDate(detail.verification.currentRequest.deadline)} />
                                    <Row label="Submitted" value={fmtDateTime(detail.verification.currentRequest.submittedAt)} />
                                    <Row label="Reviewed" value={fmtDateTime(detail.verification.currentRequest.reviewedAt)} />
                                    {detail.verification.currentRequest.videoLink && (
                                        <Row label="Video" value={
                                            <a href={detail.verification.currentRequest.videoLink} target="_blank" rel="noopener noreferrer" className="text-primary underline text-xs truncate max-w-48 block">
                                                View video
                                            </a>
                                        } />
                                    )}
                                    {detail.verification.currentRequest.rejectionReason && (
                                        <Row label="Rejection reason" value={detail.verification.currentRequest.rejectionReason} />
                                    )}
                                </>
                            )}
                            {detail.verification.history.length > 0 && (
                                <>
                                    <div className="pt-2 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">History ({detail.verification.history.length})</div>
                                    <div className="space-y-2 mt-1">
                                        {detail.verification.history.map((h, i) => (
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

                </div>
            )}
        </div>
    );
}
