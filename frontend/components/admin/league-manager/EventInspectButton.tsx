'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { API_URL } from '@/lib/api';
import { auth } from '@/lib/firebase';

type Physics = {
    frameGrams: string | null;
    frameCdaBias: string | null;
    frontWheelGrams: string | null;
    frontWheelCdaBias: string | null;
    frontWheelCrr: string | null;
    rearWheelGrams: string | null;
    rearWheelCdaBias: string | null;
    rearWheelCrr: string | null;
};

type Unlock = { tag: string; name: string | null };

export type InspectedEvent = {
    id: number;
    name: string | null;
    description: string;
    type: string | null;
    sport: string | null;
    eventStart: string | null;
    imageUrl: string | null;
    url: string | null;
    rulesId: number | null;
    rules: string[];
    cullingType: string | null;
    lateJoinInMinutes: number | null;
    visible: boolean | null;
    privateEvent: boolean | null;
    unlisted: boolean | null;
    restricted: boolean | null;
    invisibleToNonParticipants: boolean | null;
    categoryEnforcement: boolean | null;
    accessExpression: string | null;
    rangeAccessLabel: string | null;
    partnerClientId: string | null;
    signedUpCount: number | null;
    joinedCount: number | null;
    bikeHash: number | null;
    bikeName: string | null;
    frontWheelHash: string | null;
    frontWheelName: string | null;
    rearWheelHash: string | null;
    rearWheelName: string | null;
    upgradePhysicsDisabled: boolean;
    physics: Physics;
    steering: 'enabled' | 'disabled';
    brakingDisabled: boolean;
    unlocks: Unlock[];
    tags: string[];
    routeId: number | null;
    routeName: string | null;
    routeWorld: string | null;
    routeDistanceInMeters: number | null;
    routeAscentInMeters: number | null;
    leadInDistanceInMeters: number | null;
    leadInAscentInMeters: number | null;
    mapId: number | null;
    worldId: number | null;
    world: string | null;
    laps: number | null;
    distanceInMeters: number | null;
    durationInSeconds: number | null;
    subgroups: InspectedCategory[];
    raw: Record<string, unknown>;
};

type InspectedCategory = {
    id: number | null;
    name: string | null;
    label: string | null;
    eventStart: string | null;
    registrationStart: string | null;
    registrationEnd: string | null;
    lineUpStart: string | null;
    lineUpEnd: string | null;
    startLocation: number | null;
    lateJoinInMinutes: number | null;
    rangeAccessLabel: string | null;
    rules: string[];
    signedUpCount: number | null;
    joinedCount: number | null;
    steering: 'enabled' | 'disabled';
    routeName: string | null;
    routeId: number | null;
    laps: number | null;
    distanceInMeters: number | null;
    tags: string[];
};

const RULE_LABELS: Record<string, string> = {
    ENFORCE_HRM: 'Heart-rate monitor required',
    ENFORCE_NO_ZPOWER: 'No zPower',
    NO_POWERUPS: 'No powerups',
    SHOW_RACE_RESULTS: 'Results shown',
    NO_TT_BIKES: 'No TT bikes',
};

function formatWhen(value: string | null | undefined) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Copenhagen',
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(date);
}

function formatKm(meters: number | null | undefined) {
    if (meters == null || Number.isNaN(meters)) return null;
    return `${(meters / 1000).toFixed(2)} km`;
}

function formatClimb(meters: number | null | undefined) {
    if (meters == null || Number.isNaN(meters)) return null;
    return `${Math.round(meters)} m`;
}

function lengthLabel(laps: number | null | undefined, meters: number | null | undefined) {
    if (laps) return `${laps} lap${laps === 1 ? '' : 's'}`;
    return formatKm(meters) || '—';
}

function yesNo(value: boolean | null | undefined) {
    if (value == null) return '—';
    return value ? 'Yes' : 'No';
}

function named(name: string | null | undefined, hash: string | number | null | undefined) {
    if (name && hash != null && hash !== '') return `${name} (${hash})`;
    return name || (hash != null && hash !== '' ? String(hash) : '—');
}

function physicsLines(physics: Physics | undefined, upgradesDisabled: boolean) {
    const lines: string[] = [];
    if (physics?.frameGrams || physics?.frameCdaBias) {
        lines.push(`Frame ${physics.frameGrams ?? '—'} g, CdA bias ${physics.frameCdaBias ?? '—'}`);
    }
    if (physics?.frontWheelGrams || physics?.frontWheelCdaBias || physics?.frontWheelCrr) {
        lines.push(`Front wheel ${physics.frontWheelGrams ?? '—'} g, CdA bias ${physics.frontWheelCdaBias ?? '—'}, Crr ${physics.frontWheelCrr ?? '—'}`);
    }
    if (physics?.rearWheelGrams || physics?.rearWheelCdaBias || physics?.rearWheelCrr) {
        lines.push(`Rear wheel ${physics.rearWheelGrams ?? '—'} g, CdA bias ${physics.rearWheelCdaBias ?? '—'}, Crr ${physics.rearWheelCrr ?? '—'}`);
    }
    if (upgradesDisabled) lines.push('Upgrade physics disabled');
    return lines;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className="text-sm text-foreground">{children}</div>
        </div>
    );
}

function InspectBody({ event }: { event: InspectedEvent }) {
    const lines = physicsLines(event.physics, event.upgradePhysicsDisabled);
    const worldsDiffer = Boolean(event.routeWorld && event.world && event.routeWorld !== event.world);
    return (
        <div className="space-y-5">
            <div>
                <h3 className="text-lg font-semibold text-foreground">{event.name || 'Untitled event'}</h3>
                <p className="text-sm text-muted-foreground">{formatWhen(event.eventStart)}</p>
                <p className="text-sm text-muted-foreground">
                    {[event.sport, event.type, event.partnerClientId].filter(Boolean).join(' · ') || '—'}
                </p>
                {event.description ? <p className="mt-2 text-sm text-foreground">{event.description}</p> : null}
                <p className="mt-2 text-sm">
                    {event.url ? <a className="text-primary hover:underline" href={event.url} target="_blank" rel="noreferrer">Zwift</a> : null}
                    {event.imageUrl ? <> · <a className="text-primary hover:underline" href={event.imageUrl} target="_blank" rel="noreferrer">Header image</a></> : null}
                </p>
                <p className="text-sm text-muted-foreground">
                    {event.signedUpCount ?? '—'} signed up · {event.joinedCount ?? '—'} joined
                </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Steering">
                    <span className="font-semibold">{event.steering === 'disabled' ? 'Disabled' : 'Enabled'}</span>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Zwift writes steering_disabled only when steering is turned off. When that tag is missing, steering is enabled.
                    </p>
                </Field>
                <Field label="Braking">{event.brakingDisabled ? 'Disabled' : 'No nobraking tag'}</Field>
                <Field label="Route">{event.routeName || 'No route'}{event.routeId != null ? ` · ${event.routeId}` : ''}</Field>
                <Field label="Route length">{[formatKm(event.routeDistanceInMeters), formatClimb(event.routeAscentInMeters)].filter(Boolean).join(' · ') || '—'}</Field>
                <Field label="Lead-in">{[formatKm(event.leadInDistanceInMeters), formatClimb(event.leadInAscentInMeters)].filter(Boolean).join(' · ') || '—'}</Field>
                <Field label="Event length">{lengthLabel(event.laps, event.distanceInMeters)}</Field>
                <Field label="Route world">{event.routeWorld || '—'}{event.mapId != null ? ` · map ${event.mapId}` : ''}</Field>
                <Field label="Event world">
                    {event.world || '—'}{event.worldId != null ? ` · worldId ${event.worldId}` : ''}
                    {worldsDiffer ? <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">The route is on {event.routeWorld}. The stored world is still {event.world}.</p> : null}
                </Field>
                <Field label="Who you see">{event.cullingType === 'CULLING_SUBGROUP_ONLY' ? 'Own category only' : event.cullingType || '—'}</Field>
                <Field label="Late join">{event.lateJoinInMinutes != null ? `${event.lateJoinInMinutes} min` : '—'}</Field>
                <Field label="Rules">
                    {event.rules?.length ? event.rules.map(rule => RULE_LABELS[rule] || rule).join(' · ') : '—'}
                    {event.rulesId != null ? <span className="block text-xs text-muted-foreground">Rules id {event.rulesId}</span> : null}
                </Field>
                <Field label="Bike">{named(event.bikeName, event.bikeHash)}</Field>
                <Field label="Front wheel">{named(event.frontWheelName, event.frontWheelHash)}</Field>
                <Field label="Rear wheel">{named(event.rearWheelName, event.rearWheelHash)}</Field>
                <Field label="Bike physics">{lines.length ? lines.map(line => <span key={line} className="block">{line}</span>) : '—'}</Field>
                <Field label="Visible in game">{yesNo(event.visible)}</Field>
                <Field label="Unlisted">{yesNo(event.unlisted)}</Field>
                <Field label="Restricted">{yesNo(event.restricted)}</Field>
                <Field label="Private">{yesNo(event.privateEvent)}</Field>
                <Field label="Hidden from non-participants">{yesNo(event.invisibleToNonParticipants)}</Field>
                <Field label="Category enforcement">{yesNo(event.categoryEnforcement)}</Field>
                <Field label="Score range">{event.rangeAccessLabel || '—'}</Field>
            </div>

            {event.accessExpression ? (
                <Field label="Who can enter">
                    <pre className="whitespace-pre-wrap text-xs">{event.accessExpression}</pre>
                </Field>
            ) : null}

            <Field label="Tags">
                <p className="text-xs text-muted-foreground">{event.tags?.length ? event.tags.join(' · ') : 'None'}</p>
            </Field>
            {event.unlocks?.length ? (
                <Field label="Unlocks">
                    <p className="text-xs">{event.unlocks.map(unlock => unlock.name ? `${unlock.name} (${unlock.tag})` : unlock.tag).join(' · ')}</p>
                </Field>
            ) : null}

            <div className="space-y-2">
                <h4 className="text-sm font-semibold">Categories</h4>
                {(event.subgroups || []).map(group => (
                    <div key={group.id ?? group.label} className="rounded border border-border p-3">
                        <p className="text-sm font-semibold">
                            {group.label || 'Category'}
                            {group.name && group.name !== event.name ? ` · ${group.name}` : ''}
                            {group.id != null ? ` · ${group.id}` : ''}
                        </p>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2 text-sm">
                            <Field label="Start">{formatWhen(group.eventStart)}</Field>
                            <Field label="Sign-up">{formatWhen(group.registrationStart)} – {formatWhen(group.registrationEnd)}</Field>
                            <Field label="Lineup">{formatWhen(group.lineUpStart)} – {formatWhen(group.lineUpEnd)}</Field>
                            <Field label="Start pen">{group.startLocation ?? '—'}</Field>
                            <Field label="Route">{group.routeName || group.routeId || '—'}</Field>
                            <Field label="Length">{lengthLabel(group.laps, group.distanceInMeters)}</Field>
                            <Field label="Steering">
                                {group.steering === 'disabled' ? 'Disabled' : 'Enabled'}
                                {group.steering !== event.steering ? ' · differs from the event' : ''}
                            </Field>
                            <Field label="Signed up">{group.signedUpCount ?? '—'} signed up · {group.joinedCount ?? '—'} joined</Field>
                        </div>
                    </div>
                ))}
                {!event.subgroups?.length ? <p className="text-sm text-muted-foreground">No categories.</p> : null}
            </div>

            <details className="rounded border border-border p-3">
                <summary className="cursor-pointer text-sm font-semibold">Full event</summary>
                <p className="mt-2 text-xs text-muted-foreground">Zwift&apos;s event document. The join secret is left out.</p>
                <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-2 text-[11px]">{JSON.stringify(event.raw, null, 2)}</pre>
            </details>
        </div>
    );
}

export default function EventInspectButton({ eventId }: { eventId: string }) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [event, setEvent] = useState<InspectedEvent | null>(null);
    const ready = /^\d+$/.test(eventId.trim());

    useEffect(() => {
        if (!open) return;
        const onKey = (keyEvent: KeyboardEvent) => {
            if (keyEvent.key === 'Escape') setOpen(false);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open]);

    async function inspect() {
        const id = eventId.trim();
        if (!/^\d+$/.test(id)) return;
        setOpen(true);
        setLoading(true);
        setError('');
        setEvent(null);
        try {
            const token = await auth.currentUser?.getIdToken();
            const res = await fetch(`${API_URL}/admin/zwift/events/${id}`, {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(String(body?.message || body?.error || `Could not read event ${id}`));
                return;
            }
            setEvent(body as InspectedEvent);
        } catch (err) {
            const detail = err instanceof Error ? err.message : '';
            setError(
                detail && !/failed to fetch|networkerror/i.test(detail)
                    ? detail
                    : 'The inspection service did not answer. The backend deploy may still be finishing.',
            );
        } finally {
            setLoading(false);
        }
    }

    return (
        <>
            <button
                type="button"
                aria-label="Inspect Zwift event"
                title="Inspect Zwift event"
                disabled={!ready}
                onClick={() => void inspect()}
                className="shrink-0 rounded border border-input bg-background p-2 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <circle cx="11" cy="11" r="7" />
                    <path d="M20 20l-3.5-3.5" />
                </svg>
            </button>
            {open ? (
                <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Event inspection">
                    <button type="button" className="absolute inset-0 bg-black/60" aria-label="Close event inspection" onClick={() => setOpen(false)} />
                    <div className="relative z-10 max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-border bg-card p-5 shadow-xl">
                        <div className="mb-4 flex items-start justify-between gap-3">
                            <h2 className="text-base font-semibold">Event inspection · {eventId.trim()}</h2>
                            <button type="button" onClick={() => setOpen(false)} className="text-sm text-muted-foreground hover:text-foreground">Close</button>
                        </div>
                        {loading ? <p className="text-sm text-muted-foreground">Reading the event from Zwift…</p> : null}
                        {error ? <p className="text-sm text-red-600">{error}</p> : null}
                        {event ? <InspectBody event={event} /> : null}
                    </div>
                </div>
            ) : null}
        </>
    );
}
