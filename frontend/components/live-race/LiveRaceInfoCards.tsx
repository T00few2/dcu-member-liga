'use client';

import type { CurrentLiveRace } from '@/types/live';
import type { RiderGroup } from '@/lib/live-race/cluster';
import { findSelectedGroupIndex } from '@/lib/live-race/group-match';
import { speedMmPerHourToKmh } from '@/lib/live-race/position';
import { fromTimestamp } from '@/lib/formatDate';

interface Props {
    race: CurrentLiveRace;
    totalDistanceKm: number;
    leadInKm: number;
    groups: RiderGroup[];
    frontGroup: RiderGroup | null;
    selectedGroup: RiderGroup | null;
    selectedRiderIds: Set<string> | null;
    onSelectGroup: (group: RiderGroup) => void;
}

function formatElapsed(ms: number): string {
    if (ms <= 0) return "0' 00\"";
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}' ${String(s).padStart(2, '0')}"`;
    return `${m}' ${String(s).padStart(2, '0')}"`;
}

function formatRaceElapsed(race: CurrentLiveRace): string {
    const start = fromTimestamp(race.date as never);
    if (!start || Number.isNaN(start.getTime())) return '—';
    return formatElapsed(Date.now() - start.getTime());
}

export default function LiveRaceInfoCards({
    race,
    totalDistanceKm,
    leadInKm,
    groups,
    frontGroup,
    selectedGroup,
    selectedRiderIds,
    onSelectGroup,
}: Props) {
    const selectedIdx = findSelectedGroupIndex(groups, selectedRiderIds);
    const selectedKm = selectedGroup?.chartKm ?? 0;
    const raceOnlyDistanceKm = Math.max(0, totalDistanceKm - leadInKm);
    const missingKm = Math.max(0, raceOnlyDistanceKm - selectedKm);
    const showingFront = !selectedGroup || selectedGroup === frontGroup;
    const gapToFrontKm =
        selectedGroup && frontGroup
            ? Math.max(0, frontGroup.chartKm - selectedGroup.chartKm)
            : 0;

    const groupRiders = selectedGroup?.riders ?? [];

    const speeds = groupRiders
        .map((r) => speedMmPerHourToKmh(r.speedInMillimetersPerHour ?? undefined))
        .filter((v) => v > 0);
    const avgSpeed =
        speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;

    const powers = groupRiders
        .map((r) => (typeof r.powerOutputInWatts === 'number' ? r.powerOutputInWatts : 0))
        .filter((v) => v > 0);
    const avgPower =
        powers.length > 0 ? powers.reduce((a, b) => a + b, 0) / powers.length : 0;

    const drafts = groupRiders
        .map((r) => (typeof r.draftSavings === 'number' ? r.draftSavings : null))
        .filter((v): v is number => v !== null && v >= 0);
    const avgDraft =
        drafts.length > 0 ? drafts.reduce((a, b) => a + b, 0) / drafts.length : 0;

    const selectedRiders = selectedGroup
        ? [...selectedGroup.riders].sort((a, b) => {
              if (a.registered !== b.registered) return a.registered ? -1 : 1;
              return (a.name || '').localeCompare(b.name || '', 'da');
          })
        : [];

    const orderedGroups = groups.length ? [...groups].reverse() : [];

    // The largest group is always the Peloton. Ties resolve to the rear-most
    // bunch (since `groups` is sorted front-last, iterating forward picks the
    // first rear group with the max count). "Førergruppe" is only used for the
    // leading group when it is distinct from the Peloton.
    const pelotonGroup = (() => {
        if (!groups.length) return null;
        let best: RiderGroup = groups[0];
        for (const g of groups) {
            if (g.riders.length > best.riders.length) best = g;
        }
        return best;
    })();

    const labelForGroup = (g: RiderGroup, fallbackIdx: number): string => {
        if (g === pelotonGroup) return 'Peloton';
        if (g === frontGroup) return 'Førergruppe';
        return `Gruppe ${fallbackIdx}`;
    };

    const frontGroupLabel = frontGroup
        ? frontGroup === pelotonGroup
            ? 'Peloton'
            : 'Førergruppe'
        : 'Førergruppe';

    const selectedGroupLabel = selectedGroup
        ? selectedGroup === pelotonGroup
            ? 'Peloton'
            : selectedGroup === frontGroup
              ? 'Førergruppe'
              : 'Gruppe'
        : frontGroupLabel;

    const groupHeading = !selectedGroup
        ? frontGroupLabel
        : showingFront
          ? `${selectedGroupLabel} · ${selectedGroup.riders.length}`
          : `${selectedGroupLabel} · ${selectedGroup.riders.length} · +${gapToFrontKm.toFixed(1)} km bagved`;

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
            <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-3">
                    {showingFront ? 'Race data' : 'Gruppe data'}
                </h3>
                <dl className="space-y-2 text-sm">
                    <div className="flex justify-between">
                        <dt className="text-muted-foreground">Tid forløbet</dt>
                        <dd className="font-mono font-semibold text-primary">{formatRaceElapsed(race)}</dd>
                    </div>
                    <div className="flex justify-between">
                        <dt className="text-muted-foreground">Manglende km</dt>
                        <dd className="font-mono font-semibold text-primary">{missingKm.toFixed(1)} km</dd>
                    </div>
                    <div className="flex justify-between">
                        <dt className="text-muted-foreground">Hastighed</dt>
                        <dd className="font-mono font-semibold text-primary">
                            {avgSpeed > 0 ? `${avgSpeed.toFixed(1)} km/t` : '—'}
                        </dd>
                    </div>
                    <div className="flex justify-between">
                        <dt className="text-muted-foreground">Gns. Power</dt>
                        <dd className="font-mono font-semibold text-primary">
                            {avgPower > 0 ? `${Math.round(avgPower)} W` : '—'}
                        </dd>
                    </div>
                    <div className="flex justify-between">
                        <dt className="text-muted-foreground">Gns. Draft</dt>
                        <dd className="font-mono font-semibold text-primary">
                            {drafts.length > 0 ? `${Math.round(avgDraft)} W` : '—'}
                        </dd>
                    </div>
                </dl>
            </div>

            <div className="rounded-lg border border-border bg-card p-4 flex flex-col">
                <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-3">
                    {groupHeading}
                </h3>
                {selectedRiders.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Ingen aktive ryttere.</p>
                ) : (
                    <ul className="space-y-1 text-sm max-h-32 overflow-auto">
                        {selectedRiders.map((r) => (
                            <li key={r.userId} className="flex justify-between gap-2">
                                <span className={`truncate ${r.registered ? 'text-card-foreground' : 'text-muted-foreground'}`}>
                                    {r.name || `Ukendt #${r.userId.slice(0, 6)}`}
                                </span>
                                <span className="font-mono text-xs text-muted-foreground shrink-0">
                                    {r.club || '—'}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-3">Gruppeafstand</h3>
                {orderedGroups.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Ingen aktive ryttere</p>
                ) : (
                    <ul className="space-y-1 text-sm max-h-32 overflow-auto">
                        {orderedGroups.map((g, i) => {
                            const origIdx = groups.indexOf(g);
                            const isFront = g === frontGroup;
                            const isActive = origIdx === selectedIdx;
                            const gapKm = frontGroup ? Math.max(0, frontGroup.chartKm - g.chartKm) : 0;
                            const label = labelForGroup(g, i);
                            const gapLabel = isFront ? '—' : `+${gapKm.toFixed(1)} km`;
                            return (
                                <li key={i}>
                                    <button
                                        type="button"
                                        onClick={() => onSelectGroup(g)}
                                        className={`w-full flex justify-between items-center px-2 py-1 rounded text-left transition ${
                                            isActive
                                                ? 'bg-primary/10 text-primary font-semibold'
                                                : 'hover:bg-muted/30 text-muted-foreground'
                                        }`}
                                    >
                                        <span className="flex items-center gap-2">
                                            {label}
                                            <span className="text-xs opacity-70">({g.riders.length})</span>
                                        </span>
                                        <span className="font-mono text-primary">{gapLabel}</span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </div>
    );
}
