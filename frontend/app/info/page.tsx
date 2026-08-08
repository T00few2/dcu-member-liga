'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import CodeOfConductModal from '@/components/CodeOfConductModal';
import { API_URL, getZwiftInsiderUrl } from '@/lib/api';
import { useLeagueSettingsQuery, useRacesQuery, useStageRacesQuery } from '@/hooks/queries';
import { formatDateShort, fromTimestamp } from '@/lib/formatDate';
import {
    isOneDaySeasonClass,
    tourEvents,
} from '@/lib/seasonUi';
import type { Race } from '@/types/live';
import type { StageRace } from '@/types/admin';

function useVerificationCategoryNames(): string[] {
    const { data: leagueSettings } = useLeagueSettingsQuery();
    return useMemo(
        () =>
            (leagueSettings?.ligaCategories || [])
                .filter((c) => c.requiresVerification === true)
                .map((c) => c.name)
                .filter(Boolean),
        [leagueSettings?.ligaCategories],
    );
}

function joinDanishNames(names: string[]): string {
    if (names.length === 0) return '';
    if (names.length === 1) return names[0]!;
    if (names.length === 2) return `${names[0]} og ${names[1]}`;
    return `${names.slice(0, -1).join(', ')} og ${names[names.length - 1]}`;
}

function calendarEventLabel(race: Race, event?: StageRace | null): string {
    if (!event) return race.name;
    if (event.seasonClass === 'tour' && race.stageIndex != null) {
        return `${event.name} · Etape ${race.stageIndex}`;
    }
    return event.name || race.name;
}

function YderligereRegler() {
    const [open, setOpen] = useState(false);
    return (
        <>
            <p className="text-slate-600 dark:text-slate-400">
                Se vores{' '}
                <button
                    onClick={() => setOpen(true)}
                    className="text-primary underline hover:no-underline font-medium"
                >
                    adfærdskodeks
                </button>
                {' '}for yderligere regler og retningslinjer.
            </p>
            <CodeOfConductModal isOpen={open} onClose={() => setOpen(false)} />
        </>
    );
}

type Trainer = {
    id: string;
    name: string;
    status: string;
    dualRecordingRequired: boolean;
};

function TrainerStatusBadge({ trainer }: { trainer: Trainer }) {
    if (trainer.status === 'approved' && trainer.dualRecordingRequired) {
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Dual recording
            </span>
        );
    }
    if (trainer.status === 'approved') {
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                Godkendt
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Ikke godkendt
        </span>
    );
}

function UdstyrSection() {
    const verificationNames = useVerificationCategoryNames();
    const verificationLabel = joinDanishNames(verificationNames);
    const [trainers, setTrainers] = useState<Trainer[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<'all' | 'approved' | 'dual' | 'not_approved'>('all');
    const [listOpen, setListOpen] = useState(false);

    useEffect(() => {
        const load = async () => {
            try {
                const res = await fetch(`${API_URL}/trainers`);
                if (!res.ok) return;
                const data = await res.json();
                const sorted = (data.trainers || []).slice().sort((a: Trainer, b: Trainer) =>
                    a.name.localeCompare(b.name, 'da')
                );
                setTrainers(sorted);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, []);

    const filtered = trainers.filter(t => {
        const matchesSearch = t.name.toLowerCase().includes(search.toLowerCase());
        const matchesFilter =
            filter === 'all' ||
            (filter === 'approved' && t.status === 'approved' && !t.dualRecordingRequired) ||
            (filter === 'dual' && t.status === 'approved' && t.dualRecordingRequired) ||
            (filter === 'not_approved' && t.status === 'not_approved');
        return matchesSearch && matchesFilter;
    });

    const approvedCount = trainers.filter(t => t.status === 'approved' && !t.dualRecordingRequired).length;
    const dualCount = trainers.filter(t => t.status === 'approved' && t.dualRecordingRequired).length;
    const notApprovedCount = trainers.filter(t => t.status === 'not_approved').length;

    return (
        <div className="space-y-4">
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed text-lg">
                For at komme i gang med e-cykling og deltage i løb skal du bruge følgende:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                    { label: 'Cykel', desc: 'Racer, mountainbike eller gravel – så længe den passer på hometraineren.' },
                    {
                        label: 'Smart hometrainer',
                        desc: verificationLabel
                            ? `I ${verificationLabel} kræves godkendt direct drive med automatisk modstandsstyring – eller dual recording med separat wattmåler og Strava-forbindelse.`
                            : 'Godkendt direct drive med automatisk modstandsstyring. Dual recording kræves ikke for nogen kategorier i øjeblikket.',
                    },
                ].map((item, i) => (
                    <div key={i} className="flex items-start gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800">
                        <div className="mt-0.5 flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold">
                            {i + 1}
                        </div>
                        <div>
                            <div className="font-semibold text-slate-800 dark:text-slate-100 mb-0.5">{item.label}</div>
                            <div className="text-slate-600 dark:text-slate-400 text-sm">{item.desc}</div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Trainer approval status list – collapsible */}
            <div className={`mt-2 rounded-xl border transition-all duration-200 overflow-hidden ${listOpen ? 'border-primary/30 shadow-md shadow-primary/5' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'}`}>
                <button
                    onClick={() => setListOpen(o => !o)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 text-left bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                >
                    <div className="p-2 rounded-lg flex-shrink-0 bg-blue-500/10 text-blue-600 dark:text-blue-400">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="font-semibold text-slate-800 dark:text-slate-100 text-sm">Godkendte hometrainere</div>
                        {!listOpen && !loading && trainers.length > 0 && (
                            <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                                {approvedCount} godkendt · {dualCount} dual recording · {notApprovedCount} ikke godkendt
                            </div>
                        )}
                    </div>
                    <svg
                        className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform duration-300 ${listOpen ? 'rotate-180' : ''}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                </button>

                <div className={`overflow-hidden transition-all duration-300 ${listOpen ? 'max-h-[9999px] opacity-100' : 'max-h-0 opacity-0'}`}>
                    <div className="border-t border-slate-100 dark:border-slate-800">
                        {/* Filter + search */}
                        <div className="px-4 py-2.5 bg-white dark:bg-slate-900/40 border-b border-slate-100 dark:border-slate-800 flex flex-wrap gap-2 items-center justify-between">
                            <div className="flex flex-wrap gap-2 text-xs">
                                <button
                                    onClick={() => setFilter('all')}
                                    className={`px-2.5 py-1 rounded-full font-medium transition-colors ${filter === 'all' ? 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                                >
                                    Alle ({trainers.length})
                                </button>
                                <button
                                    onClick={() => setFilter('approved')}
                                    className={`px-2.5 py-1 rounded-full font-medium transition-colors ${filter === 'approved' ? 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                                >
                                    Godkendt ({approvedCount})
                                </button>
                                <button
                                    onClick={() => setFilter('dual')}
                                    className={`px-2.5 py-1 rounded-full font-medium transition-colors ${filter === 'dual' ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                                >
                                    Dual recording ({dualCount})
                                </button>
                                <button
                                    onClick={() => setFilter('not_approved')}
                                    className={`px-2.5 py-1 rounded-full font-medium transition-colors ${filter === 'not_approved' ? 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                                >
                                    Ikke godkendt ({notApprovedCount})
                                </button>
                            </div>
                            <input
                                type="search"
                                placeholder="Søg hometrainer..."
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-primary w-48"
                            />
                        </div>

                        {loading ? (
                            <div className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                                Indlæser hometrainere...
                            </div>
                        ) : filtered.length === 0 ? (
                            <div className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                                {trainers.length === 0 ? 'Ingen hometrainere registreret endnu.' : 'Ingen hometrainere matcher søgningen.'}
                            </div>
                        ) : (
                            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                                {filtered.map(trainer => (
                                    <li key={trainer.id} className="flex items-center justify-between px-4 py-2.5 bg-white dark:bg-slate-900/40 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                                        <span className="text-sm text-slate-700 dark:text-slate-200">{trainer.name}</span>
                                        <TrainerStatusBadge trainer={trainer} />
                                    </li>
                                ))}
                            </ul>
                        )}

                        <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-800">
                            <p className="text-xs text-slate-400 dark:text-slate-500">
                                Mangler din hometrainer? Du kan anmode om godkendelse under tilmelding.
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                    { label: 'Enhed til software', desc: 'PC, Mac, Apple TV, iPad eller nyere smartphone.' },
                    { label: 'Zwift-konto', desc: 'Ligaen afvikles på Zwift. Du skal oprette en konto og tilmelde dig via denne hjemmeside.' },
                    { label: 'Pulsmåler', desc: 'Brystrem eller armbånd – påkrævet i de fleste løb for at sikre fair konkurrence.' },
                ].map((item, i) => (
                    <div key={i} className="flex items-start gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800">
                        <div className="mt-0.5 flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold">
                            {i + 3}
                        </div>
                        <div>
                            <div className="font-semibold text-slate-800 dark:text-slate-100 mb-0.5">{item.label}</div>
                            <div className="text-slate-600 dark:text-slate-400 text-sm">{item.desc}</div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function SaesonformatSection() {
    const stageRacesQuery = useStageRacesQuery();
    const stageRaces = stageRacesQuery.data ?? [];
    const tours = useMemo(() => tourEvents(stageRaces), [stageRaces]);
    const klassikerCount = useMemo(
        () => stageRaces.filter((e) => isOneDaySeasonClass(e.seasonClass)).length,
        [stageRaces],
    );

    const tourPhrase =
        tours.length > 0
            ? joinDanishNames(tours.map((t) => t.name))
            : '1 Tour';
    const klassikerLabel = klassikerCount === 1 ? '1 Klassiker' : `${klassikerCount || 5} Klassikere`;

    return (
        <div className="space-y-5">
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed text-lg">
                Sæsonen i <strong className="text-slate-800 dark:text-white">DCU E-serien</strong> bygges op af{' '}
                <strong className="text-slate-800 dark:text-white">{tourPhrase}</strong>
                {' '}(flere etaper + samlet GC) og{' '}
                <strong className="text-slate-800 dark:text-white">{klassikerLabel}</strong>.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {(tours.length > 0
                    ? tours.map((tour) => ({
                        key: tour.id,
                        title: tour.name,
                        sub: 'etaper + samlet stilling',
                        kind: 'tour' as const,
                    }))
                    : [{ key: 'tour-fallback', title: 'Tour', sub: 'etaper + samlet stilling', kind: 'tour' as const }]
                ).map((card) => (
                    <div
                        key={card.key}
                        className="text-center p-5 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800"
                    >
                        <div className="text-xl sm:text-2xl font-extrabold text-primary mb-1 leading-snug">
                            {card.title}
                        </div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
                            Tour
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">{card.sub}</div>
                    </div>
                ))}
                <div className="text-center p-5 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800">
                    <div className="text-4xl font-extrabold text-primary mb-1">{klassikerCount || 5}</div>
                    <div className="font-semibold text-slate-800 dark:text-slate-100">Klassikere</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">enkeltdagsløb</div>
                </div>
            </div>
            <div className="space-y-3">
                <h4 className="font-bold text-slate-800 dark:text-white text-lg">Sådan fungerer point</h4>
                {[
                    'I hvert løb optjener du point ved spurter undervejs og ved målstregen.',
                    'Din samlede pointscore i løbet afgør din placering den dag.',
                    'Placeringen giver sæsonpoint – Tour-etaper, Tour-samlet (GC) og Klassikere tæller til Sæsonstillingen.',
                ].map((step, i) => (
                    <div key={i} className="flex gap-3 items-start">
                        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center mt-0.5">
                            {i + 1}
                        </div>
                        <p className="text-slate-600 dark:text-slate-300">{step}</p>
                    </div>
                ))}
            </div>
            <div className="flex flex-wrap gap-3 pt-2">
                <Link href="/schedule" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white font-semibold hover:bg-primary-dark transition">
                    Sæsonkalender &rarr;
                </Link>
                <Link href="/point" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border bg-card font-semibold hover:bg-muted transition">
                    Se pointskalaer &rarr;
                </Link>
                <Link href="/results" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border bg-card font-semibold hover:bg-muted transition">
                    Resultater &rarr;
                </Link>
            </div>
        </div>
    );
}

function RuterSection() {
    const racesQuery = useRacesQuery();
    const stageRacesQuery = useStageRacesQuery();
    const races = racesQuery.data ?? [];
    const stageRaces = stageRacesQuery.data ?? [];
    const eventsById = useMemo(
        () => new Map(stageRaces.map((e) => [e.id, e])),
        [stageRaces],
    );

    const rows = useMemo(() => {
        return [...races]
            .sort((a, b) => {
                const ta = fromTimestamp(a.date)?.getTime() ?? Number.POSITIVE_INFINITY;
                const tb = fromTimestamp(b.date)?.getTime() ?? Number.POSITIVE_INFINITY;
                return ta - tb;
            })
            .map((race) => {
                const event = race.stageRaceId ? eventsById.get(race.stageRaceId) : undefined;
                return {
                    id: race.id,
                    dateLabel: (() => {
                        const d = fromTimestamp(race.date);
                        return d ? formatDateShort(d) : '—';
                    })(),
                    eventLabel: calendarEventLabel(race, event),
                    world: race.map || '—',
                    route: race.routeName || '—',
                    routeUrl: race.routeName ? getZwiftInsiderUrl(race.routeName) : null,
                };
            });
    }, [races, eventsById]);

    const loading = racesQuery.isLoading || stageRacesQuery.isLoading;

    return (
        <div className="space-y-4">
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                Oversigt over sæsonens løb og ruter. Åbn sæsonkalenderen for race cards med ruteprofil
                og tilmelding.
            </p>

            {loading ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">Indlæser kalender…</p>
            ) : rows.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">Ingen løb planlagt endnu.</p>
            ) : (
                <>
                    {/* Mobile: stacked rows — no horizontal scroll */}
                    <ul className="sm:hidden divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                        {rows.map((row) => (
                            <li key={row.id} className="bg-white dark:bg-slate-900 px-3 py-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                            {row.dateLabel}
                                        </div>
                                        <div className="font-semibold text-slate-800 dark:text-slate-100 mt-0.5 break-words">
                                            {row.eventLabel}
                                        </div>
                                        <div className="text-sm text-slate-600 dark:text-slate-300 mt-0.5 break-words">
                                            <span className="font-medium text-slate-800 dark:text-slate-100">
                                                {row.world}
                                            </span>
                                            <span className="text-slate-400 dark:text-slate-500"> · </span>
                                            {row.route}
                                        </div>
                                    </div>
                                    {row.routeUrl ? (
                                        <a
                                            href={row.routeUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="shrink-0 text-primary font-semibold text-sm hover:underline pt-0.5"
                                        >
                                            ZI ↗
                                        </a>
                                    ) : null}
                                </div>
                            </li>
                        ))}
                    </ul>

                    {/* sm+: compact table; text wraps so it fits narrow tablets too */}
                    <div className="hidden sm:block rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                        <table className="w-full text-sm text-left border-collapse table-fixed">
                            <thead>
                                <tr className="bg-slate-50 dark:bg-slate-900/60 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                    <th className="px-3 py-2.5 font-semibold w-[7.5rem]">Dato</th>
                                    <th className="px-3 py-2.5 font-semibold w-[30%]">Event</th>
                                    <th className="px-3 py-2.5 font-semibold">Rute</th>
                                    <th className="px-3 py-2.5 font-semibold text-right w-14">Link</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {rows.map((row) => (
                                    <tr key={row.id} className="bg-white dark:bg-slate-900">
                                        <th
                                            scope="row"
                                            className="px-3 py-2.5 font-medium text-slate-800 dark:text-slate-100 whitespace-nowrap align-top"
                                        >
                                            {row.dateLabel}
                                        </th>
                                        <td className="px-3 py-2.5 text-slate-700 dark:text-slate-200 break-words align-top">
                                            {row.eventLabel}
                                        </td>
                                        <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300 break-words align-top">
                                            <span className="font-medium text-slate-800 dark:text-slate-100">
                                                {row.world}
                                            </span>
                                            <span className="text-slate-400 dark:text-slate-500"> · </span>
                                            {row.route}
                                        </td>
                                        <td className="px-3 py-2.5 text-right whitespace-nowrap align-top">
                                            {row.routeUrl ? (
                                                <a
                                                    href={row.routeUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-primary font-semibold hover:underline"
                                                >
                                                    ZI ↗
                                                </a>
                                            ) : (
                                                <span className="text-slate-400">—</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            <Link
                href="/schedule"
                className="inline-flex items-center gap-2 text-primary font-semibold hover:underline"
            >
                Åbn sæsonkalenderen &rarr;
            </Link>
        </div>
    );
}

function ReglerSection() {
    const verificationNames = useVerificationCategoryNames();
    const verificationLabel = joinDanishNames(verificationNames);

    return (
        <div className="space-y-5">
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed text-lg">
                For at sikre fair play og god konkurrence er der visse retningslinjer du skal overholde:
            </p>
            <div className="space-y-4">
                <div className="pl-4 border-l-4 border-primary">
                    <h4 className="font-bold text-slate-900 dark:text-white mb-1">Registrering af højde og vægt</h4>
                    <p className="text-slate-600 dark:text-slate-400">Deltagere skal være registreret med korrekt højde og vægt på deres profil samt i Zwift, så Watt/kg udregnes korrekt i spillet.</p>
                </div>
                <div className="pl-4 border-l-4 border-tertiary">
                    <h4 className="font-bold text-slate-900 dark:text-white mb-1">Stikprøvekontrol (Weight Verification)</h4>
                    <p className="text-slate-600 dark:text-slate-400">
                        {verificationLabel
                            ? `For ryttere i ${verificationLabel} vil der fra tid til anden blive krævet videodokumentation af den aktuelle vægt.`
                            : 'Der kræves i øjeblikket ikke vægtverifikation for nogen kategorier.'}
                    </p>
                </div>
                <div className="pl-4 border-l-4 border-blue-500">
                    <h4 className="font-bold text-slate-900 dark:text-white mb-1">Tilslutning af profil</h4>
                    <p className="text-slate-600 dark:text-slate-400">
                        Husk at forbinde din Zwift- og Strava-konto (begge er påkrævet) i dine brugerindstillinger her på siden, før du tilmelder dig et løb.
                    </p>
                </div>
                <div className="pl-4 border-l-4 border-orange-400">
                    <h4 className="font-bold text-slate-900 dark:text-white mb-1">Godkendt hometrainer eller dual recording</h4>
                    {verificationLabel ? (
                        <>
                            <p className="text-slate-600 dark:text-slate-400 mb-2">
                                Ryttere i <strong>{verificationLabel}</strong> skal enten benytte en <strong>godkendt smart hometrainer</strong> (direct drive med automatisk modstandsstyring) eller foretage <strong>dual recording</strong> med en separat wattmåler.
                            </p>
                            <p className="text-slate-600 dark:text-slate-400">
                                Ved dual recording skal aktiviteten uploades til <strong>Strava</strong>, og din Strava-konto skal være forbundet med din profil her på siden. Strava-data bruges kun til admin kontrol af wattdata.
                            </p>
                        </>
                    ) : (
                        <p className="text-slate-600 dark:text-slate-400">
                            Dual recording kræves i øjeblikket ikke for nogen kategorier.
                        </p>
                    )}
                </div>
                <div className="pl-4 border-l-4 border-slate-400">
                    <h4 className="font-bold text-slate-900 dark:text-white mb-1">Yderligere regler</h4>
                    <YderligereRegler />
                </div>
            </div>
        </div>
    );
}

const chapters = [
    {
        id: 'ecycling',
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
        ),
        iconBg: 'bg-primary/10 text-primary',
        title: 'Om E-cykling',
        defaultOpen: false,
        content: (
            <div className="space-y-4">
                <p className="text-slate-600 dark:text-slate-300 leading-relaxed text-lg">
                    E-cykling (elektronisk cykling) kombinerer den fysiske anstrengelse fra traditionel cykling med en virtuel oplevelse.
                    Ved hjælp af en hometrainer koblet til en skærm overføres dine tråd i pedalerne til en avatar i et digitalt univers.
                    Det giver dig mulighed for at cykle på virtuelle ruter, træne med venner eller konkurrere i løb mod ryttere fra hele verden – uanset vind og vejr udenfor.
                </p>
                <p className="text-slate-600 dark:text-slate-300 leading-relaxed text-lg">
                    E-cykling er en af de hurtigst voksende cykeldiscipliner og afvikles på platforme som Zwift, TrainingPeaks Virtual, ROUVY og MyWhoosh. DCU E-serien afvikles på <strong>Zwift</strong>.
                </p>
            </div>
        ),
    },
    {
        id: 'udstyr',
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
        ),
        iconBg: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
        title: 'Udstyr',
        defaultOpen: false,
        content: <UdstyrSection />,
    },
    {
        id: 'regler',
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
        ),
        iconBg: 'bg-green-500/10 text-green-600 dark:text-green-400',
        title: 'Deltagelse og Regler',
        defaultOpen: false,
        content: <ReglerSection />,
    },
    {
        id: 'kategorier',
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
        ),
        iconBg: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
        title: 'Rytterkategorier',
        defaultOpen: false,
        content: (
            <div className="space-y-6">
                {/* Intro */}
                <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                    Kategoriseringen er baseret på <strong>vELO</strong> – et dynamisk ratingssystem fra{' '}
                    <a href="https://www.zwiftracing.app/reference/categories" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">ZwiftRacing.app</a>{' '}
                    der løbende opdateres baseret på dine resultater mod andre ryttere.
                    Jo stærkere modstandere du slår, desto mere stiger din vELO.
                    Ligaen bruger dit <strong>max30-rating</strong> – dit højeste vELO-gennemsnit de seneste 30 dage.
                </p>

                {/* Flow steps */}
                <div className="space-y-3">
                    <h4 className="font-bold text-slate-900 dark:text-white text-base">Sådan fungerer kategoriforløbet</h4>
                    {[
                        {
                            step: '1',
                            color: 'bg-blue-500',
                            title: 'Automatisk tildeling ved tilmelding',
                            desc: 'Når du tilmelder dig ligaen henter vi dit aktuelle max30-vELO fra ZwiftRacing og placerer dig automatisk i den tilsvarende kategori. Kategorien opdateres automatisk dagligt frem til dit første løb.',
                        },
                        {
                            step: '2',
                            color: 'bg-purple-500',
                            title: 'Selvvalg af kategori (Min Profil)',
                            desc: 'Via "Min Profil → Kategori" kan du vælge din auto-tildelte kategori eller en højere kategori. Det er ikke muligt at vælge en lavere kategori end den auto-tildelte.',
                        },
                        {
                            step: '3',
                            color: 'bg-amber-500',
                            title: 'Grace-periode (+35 vELO)',
                            desc: 'Har dit max30-rating passeret din kategoris øvre grænse, men er du stadig inden for grace-grænsen (+35 vELO), er du i "grace". Du fuldfører sæsonen i din nuværende kategori, men bør forberede dig på oprykning til næste sæson.',
                        },
                        {
                            step: '4',
                            color: 'bg-red-500',
                            title: 'Kategorilåsning efter første løb',
                            desc: 'Så snart du har gennemført et officielt ligaløb, låses din kategori for resten af sæsonen. En admin kan fremtvinge en oprykning (aldrig en nedrykning) hvis dit vELO er markant over grænsen.',
                        },
                    ].map(item => (
                        <div key={item.step} className="flex items-start gap-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800">
                            <div className={`flex-shrink-0 w-8 h-8 rounded-full ${item.color} text-white flex items-center justify-center text-sm font-bold`}>
                                {item.step}
                            </div>
                            <div>
                                <p className="font-semibold text-slate-800 dark:text-slate-100 mb-0.5">{item.title}</p>
                                <p className="text-slate-600 dark:text-slate-400 text-sm">{item.desc}</p>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Info box */}
                <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-sm flex gap-3">
                    <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>
                        vELO har 10 navngivne kategorier. I ligaen kan kategorier blive <strong>slået sammen eller opdelt</strong> for at sikre tilstrækkeligt – men ikke for mange – ryttere i hver startgruppe.
                        De endelige ligakategorier offentliggøres inden sæsonstart.
                    </span>
                </div>

                {/* Category table */}
                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">
                                <th className="px-4 py-3 text-left font-bold">Gem</th>
                                <th className="px-4 py-3 text-left font-bold">Kategori</th>
                                <th className="px-4 py-3 text-left font-bold">vELO interval</th>
                                <th className="px-4 py-3 text-left font-bold">Grace-grænse</th>
                                <th className="px-4 py-3 text-left font-bold">Niveau</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {[
                                { gem: '💎', name: 'Diamond',  color: '#b9f2ff', textColor: '#0e4f6b', range: '≥ 2200',       grace: '∞',     niveau: 'Absolut elite' },
                                { gem: '♦️', name: 'Ruby',     color: '#ff4e6a', textColor: '#fff',    range: '1900 – 2199',  grace: '2235',  niveau: 'Elite' },
                                { gem: '💚', name: 'Emerald',  color: '#50c878', textColor: '#fff',    range: '1650 – 1899',  grace: '1935',  niveau: 'Meget stærk' },
                                { gem: '💙', name: 'Sapphire', color: '#0f52ba', textColor: '#fff',    range: '1450 – 1649',  grace: '1685',  niveau: 'Stærk' },
                                { gem: '💜', name: 'Amethyst', color: '#9b59b6', textColor: '#fff',    range: '1300 – 1449',  grace: '1485',  niveau: 'Avanceret' },
                                { gem: '⬜', name: 'Platinum', color: '#e5e4e2', textColor: '#374151', range: '1150 – 1299',  grace: '1335',  niveau: 'Øvet+' },
                                { gem: '🥇', name: 'Gold',     color: '#ffd700', textColor: '#374151', range: '1000 – 1149',  grace: '1185',  niveau: 'Øvet' },
                                { gem: '🥈', name: 'Silver',   color: '#c0c0c0', textColor: '#374151', range: '850 – 999',    grace: '1035',  niveau: 'Motionist+' },
                                { gem: '🥉', name: 'Bronze',   color: '#cd7f32', textColor: '#fff',    range: '650 – 849',    grace: '885',   niveau: 'Motionist' },
                                { gem: '🔶', name: 'Copper',   color: '#b87333', textColor: '#fff',    range: '0 – 649',      grace: '685',   niveau: 'Begynder' },
                            ].map((row, i) => (
                                <tr key={i} className="bg-white dark:bg-slate-900/50 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                    <td className="px-4 py-2.5 text-lg">{row.gem}</td>
                                    <td className="px-4 py-2.5">
                                        <span
                                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold"
                                            style={{ backgroundColor: row.color, color: row.textColor }}
                                        >
                                            {row.name}
                                        </span>
                                    </td>
                                    <td className="px-4 py-2.5 font-mono text-slate-700 dark:text-slate-200 text-xs">{row.range}</td>
                                    <td className="px-4 py-2.5 font-mono text-slate-500 dark:text-slate-400 text-xs">{row.grace}</td>
                                    <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{row.niveau}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                    Grace-grænsen er 35 vELO-point over den øvre kategorgrænse. Find dit aktuelle vELO på{' '}
                    <a href="https://www.zwiftracing.app/reference/categories" target="_blank" rel="noopener noreferrer" className="underline">zwiftracing.app</a>.
                    Du kan se og justere din kategori under{' '}
                    <Link href="/register" className="underline text-primary">Min Profil → Kategori</Link>.
                </p>
            </div>
        ),
    },
    {
        id: 'format',
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
            </svg>
        ),
        iconBg: 'bg-red-500/10 text-red-600 dark:text-red-400',
        title: 'Sæsonformat',
        defaultOpen: false,
        content: <SaesonformatSection />,
    },
    {
        id: 'ruter',
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
        ),
        iconBg: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
        title: 'Ruter og kalender',
        defaultOpen: false,
        content: <RuterSection />,
    },
    {
        id: 'point',
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
        ),
        iconBg: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
        title: 'Point',
        defaultOpen: false,
        content: (
            <div className="space-y-4">
                <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                    Alle pointskalaer for løb (mål, spurt, løbsplacering) og sæsonpoint
                    (Tour samlet, Tour-etape, Klassiker) ligger på point-siden.
                </p>
                <Link href="/point" className="inline-flex items-center gap-2 text-primary font-semibold hover:underline">
                    Se alle pointskalaer &rarr;
                </Link>
            </div>
        ),
    },

];

function ChapterAccordion({ chapter, isOpen, onToggle }: {
    chapter: typeof chapters[0];
    isOpen: boolean;
    onToggle: () => void;
}) {
    return (
        <div className={`rounded-2xl border transition-all duration-200 overflow-hidden ${isOpen
            ? 'border-primary/30 shadow-md shadow-primary/5'
            : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
            }`}>
            <button
                onClick={onToggle}
                className="w-full flex items-center gap-4 px-6 py-5 text-left bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
            >
                <div className={`p-2.5 rounded-xl flex-shrink-0 ${chapter.iconBg}`}>
                    {chapter.icon}
                </div>
                <span className="text-lg font-bold text-slate-900 dark:text-white flex-1">{chapter.title}</span>
                <svg
                    className={`w-5 h-5 text-slate-400 flex-shrink-0 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            <div className={`overflow-hidden transition-all duration-300 ${isOpen ? 'max-h-[9999px] opacity-100' : 'max-h-0 opacity-0'}`}>
                <div className="px-6 pb-6 pt-2 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800">
                    {chapter.content}
                </div>
            </div>
        </div>
    );
}

export default function InfoPage() {
    const [openChapters, setOpenChapters] = useState<Record<string, boolean>>(
        Object.fromEntries(chapters.map(c => [c.id, c.defaultOpen]))
    );

    const toggle = (id: string) => setOpenChapters(prev => ({ ...prev, [id]: !prev[id] }));
    const allOpen = chapters.every(c => openChapters[c.id]);
    const toggleAll = () => {
        const next = !allOpen;
        setOpenChapters(Object.fromEntries(chapters.map(c => [c.id, next])));
    };

    return (
        <div className="w-full relative -mt-4 text-foreground bg-background">
            {/* Hero */}
            <div className="relative w-full min-h-[45vh] flex flex-col items-center justify-center overflow-hidden bg-black pb-16 pt-8">
                <video autoPlay loop muted playsInline preload="auto" className="absolute inset-0 w-full h-full object-cover z-0 opacity-40 mix-blend-screen bg-black">
                    <source src="/hero-video.mp4" type="video/mp4" />
                </video>
                <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/50 to-background/95 z-0" />
                <div className="absolute top-1/4 left-1/4 w-[30rem] h-[30rem] bg-primary/20 rounded-full mix-blend-screen filter blur-[120px] animate-pulse z-0" />
                <div className="absolute bottom-1/4 right-1/4 w-[30rem] h-[30rem] bg-white/10 rounded-full mix-blend-screen filter blur-[120px] animate-pulse [animation-delay:2s] z-0" />

                <div className="relative z-10 flex flex-col items-center text-center px-4 mt-8 max-w-5xl mx-auto">
                    <h1 className="text-5xl md:text-6xl font-extrabold mb-4 tracking-tight text-white drop-shadow-lg pb-2 animate-in fade-in zoom-in-95 duration-1000">
                        Sæson<span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-white">info</span>
                    </h1>
                    <p className="text-xl mb-8 max-w-2xl text-slate-300 font-light drop-shadow animate-in fade-in slide-in-from-bottom-4 duration-1000 delay-150">
                        Alt du skal vide om format, kategorier og pointsystem
                    </p>
                </div>
            </div>

            {/* Content */}
            <div className="container mx-auto px-4 -mt-12 relative z-20 pb-20 animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-300 max-w-4xl">

                {/* Expand/Collapse all */}
                <div className="flex justify-end mb-4">
                    <button
                        onClick={toggleAll}
                        className="text-sm text-slate-500 dark:text-slate-400 hover:text-primary dark:hover:text-primary transition-colors flex items-center gap-1.5"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            {allOpen
                                ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                                : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            }
                        </svg>
                        {allOpen ? 'Luk alle' : 'Åbn alle'}
                    </button>
                </div>

                <div className="space-y-3">
                    {chapters.map(chapter => (
                        <ChapterAccordion
                            key={chapter.id}
                            chapter={chapter}
                            isOpen={!!openChapters[chapter.id]}
                            onToggle={() => toggle(chapter.id)}
                        />
                    ))}
                </div>

                <div className="mt-12 text-center">
                    <Link href="/" className="inline-flex items-center gap-2 justify-center px-8 py-4 text-base font-bold rounded-xl text-slate-700 bg-white hover:bg-slate-50 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700 shadow-sm border border-slate-200 dark:border-slate-700 transition-all hover:scale-[1.02]">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
                        </svg>
                        Tilbage til forsiden
                    </Link>
                </div>
            </div>
        </div>
    );
}
