'use client';

import { useState } from 'react';
import StravaAttribution from '@/components/StravaAttribution';

interface ConnectionsFormProps {
    stravaConnected: boolean;
    zwiftConnected: boolean;
    dualRecordingRequiresStrava?: boolean;
    /** Category names where dual-recording reports apply (from league settings). */
    verificationCategoryNames?: string[];
    handleConnectStrava: () => void | Promise<void>;
    handleDisconnectStrava: () => void;
    handleConnectZwift: () => void | Promise<void>;
    handleDisconnectZwift: () => void;
    /** Linked Discord username, or null. The Discord section shows when the handlers are given. */
    discordUsername?: string | null;
    handleConnectDiscord?: () => void | Promise<void>;
    handleDisconnectDiscord?: () => void;
}

function joinDanishNames(names: string[]): string {
    if (names.length === 0) return '';
    if (names.length === 1) return names[0]!;
    if (names.length === 2) return `${names[0]} og ${names[1]}`;
    return `${names.slice(0, -1).join(', ')} og ${names[names.length - 1]}`;
}

export default function ConnectionsForm({
    stravaConnected,
    zwiftConnected,
    dualRecordingRequiresStrava = false,
    verificationCategoryNames = [],
    handleConnectStrava,
    handleDisconnectStrava,
    handleConnectZwift,
    handleDisconnectZwift,
    discordUsername = null,
    handleConnectDiscord,
    handleDisconnectDiscord,
}: ConnectionsFormProps) {
    const [zwiftLogoFailed, setZwiftLogoFailed] = useState(false);
    // Starting a login (Zwift, Strava, Discord) takes a moment before the browser leaves the
    // page; show it, and ignore further clicks meanwhile.
    const [connecting, setConnecting] = useState<'zwift' | 'strava' | 'discord' | null>(null);
    const connectWith = (which: 'zwift' | 'strava' | 'discord', start?: () => void | Promise<void>) => async () => {
        if (!start || connecting) return;
        setConnecting(which);
        try {
            await start();
        } finally {
            setConnecting(null);
        }
    };
    const verificationLabel = joinDanishNames(verificationCategoryNames);

    return (
        <div className="space-y-8">
            {/* Zwift Section */}
            <div>
                <h3 className="text-lg font-semibold mb-3 text-card-foreground">Zwift Link</h3>
                <div
                    className={`p-4 border rounded-lg transition-colors ${
                        zwiftConnected ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800' : 'bg-card border-border'
                    }`}
                >
                    <div className="mb-4 rounded-lg border border-border bg-background px-4 py-3">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#FC6719]">
                            Official Partner Connection
                        </div>
                        {!zwiftLogoFailed ? (
                            <img
                                src="/zwift/zwiftlink-logo-lockups-generic-horizonal.png"
                                alt="Zwift x DCU lockup"
                                className="h-10 w-auto object-contain"
                                onError={() => setZwiftLogoFailed(true)}
                            />
                        ) : (
                            <div className="text-sm font-semibold text-card-foreground">Zwift Link</div>
                        )}
                    </div>
                    <div className="mb-4">
                        <p className="text-sm text-muted-foreground">
                            Forbind din konto via <strong>Zwift Link</strong> for at dele officielle Zwift-data med DCU Liga.
                        </p>
                    </div>

                    {zwiftConnected ? (
                        <div className="flex items-center justify-between bg-white dark:bg-black/20 p-4 rounded border border-border">
                            <div className="flex items-center gap-2 text-green-600 dark:text-green-400 font-medium">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                                Forbundet til Zwift Link
                            </div>
                            <button
                                onClick={handleDisconnectZwift}
                                className="cursor-pointer text-sm text-red-600 hover:text-red-700 hover:underline"
                            >
                                Frakobl
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={connectWith('zwift', handleConnectZwift)}
                            disabled={connecting !== null}
                            aria-busy={connecting === 'zwift'}
                            className="cursor-pointer px-4 py-2 rounded-lg bg-[#FC6719] text-white hover:brightness-95 active:scale-[0.97] transition font-medium border border-[#FC6719] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FC6719] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70"
                        >
                            {connecting === 'zwift' ? 'Forbinder…' : 'Forbind med Zwift Link'}
                        </button>
                    )}
                </div>
            </div>

            {/* Strava Section */}
            <div>
                <h3 className="text-lg font-semibold mb-3 text-card-foreground">Strava Forbindelse</h3>
                <div className={`p-4 border rounded-lg transition-colors ${stravaConnected ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800' : 'bg-card border-border'}`}>

                    <div className="mb-4">
                        <p className="text-sm text-muted-foreground">
                            Strava-forbindelse er påkrævet for alle ryttere, så admins kan validere dual recording ved behov.
                        </p>
                    </div>
                    {!stravaConnected && (
                        <div className="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200">
                            ⚠️ Strava-forbindelse er påkrævet for at gennemføre din profil.
                        </div>
                    )}
                    {dualRecordingRequiresStrava && (
                        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100">
                            Din valgte hometrainer kræver dual recording
                            {verificationLabel ? ` i ${verificationLabel}` : ''}
                            . Strava bruges til automatisk upload ved kontrol.
                        </div>
                    )}

                    {stravaConnected ? (
                        <div className="flex items-center justify-between bg-white dark:bg-black/20 p-4 rounded border border-border">
                            <div className="flex items-center gap-2 text-green-600 dark:text-green-400 font-medium">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                                Forbundet til Strava (admin-validering)
                            </div>
                            <button
                                onClick={handleDisconnectStrava}
                                className="cursor-pointer text-sm text-red-600 hover:text-red-700 hover:underline"
                            >
                                Frakobl
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center justify-between gap-4">
                            <button
                                onClick={connectWith('strava', handleConnectStrava)}
                                disabled={connecting !== null}
                                aria-busy={connecting === 'strava'}
                                className="cursor-pointer inline-flex items-center justify-start rounded-lg active:scale-[0.97] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
                                aria-label="Connect with Strava"
                            >
                                <img
                                    src="/strava/btn_strava_connect_with_orange.svg"
                                    alt="Connect with Strava"
                                    className="h-12 w-auto"
                                />
                            </button>
                            <StravaAttribution className="shrink-0" />
                        </div>
                    )}
                </div>
            </div>

            {handleConnectDiscord && handleDisconnectDiscord && (
                <div>
                    <h3 className="text-lg font-semibold mb-3 text-card-foreground">Discord (valgfrit)</h3>
                    <div className={`p-4 border rounded-lg transition-colors ${discordUsername ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800' : 'bg-card border-border'}`}>
                        <p className="mb-4 text-sm text-muted-foreground">
                            Forbind din Discord-konto, så vi kan kommunikere med dig på Discord, og vores Discord-bot ved, hvem du er. Vi gemmer kun dit Discord-ID og brugernavn.
                        </p>
                        {discordUsername ? (
                            <div className="flex items-center justify-between bg-white dark:bg-black/20 p-4 rounded border border-border">
                                <div className="flex items-center gap-2 text-green-600 dark:text-green-400 font-medium">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                                    Forbundet som @{discordUsername}
                                </div>
                                <button onClick={handleDisconnectDiscord} className="cursor-pointer text-sm text-red-600 hover:text-red-700 hover:underline">
                                    Frakobl
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={connectWith('discord', handleConnectDiscord)}
                                disabled={connecting !== null}
                                aria-busy={connecting === 'discord'}
                                className="cursor-pointer px-4 py-2 rounded-lg bg-[#5865F2] text-white hover:brightness-95 active:scale-[0.97] transition font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5865F2] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70"
                            >
                                {connecting === 'discord' ? 'Forbinder…' : 'Forbind Discord'}
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
