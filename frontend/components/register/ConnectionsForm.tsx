'use client';

import { useState } from 'react';
import StravaAttribution from '@/components/StravaAttribution';

interface ConnectionsFormProps {
    stravaConnected: boolean;
    zwiftConnected: boolean;
    handleConnectStrava: () => void;
    handleDisconnectStrava: () => void;
    handleConnectZwift: () => void;
    handleDisconnectZwift: () => void;
}

export default function ConnectionsForm({
    stravaConnected, zwiftConnected, handleConnectStrava, handleDisconnectStrava, handleConnectZwift, handleDisconnectZwift
}: ConnectionsFormProps) {
    const [zwiftLogoFailed, setZwiftLogoFailed] = useState(false);

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
                    <div className="mb-4 rounded-lg border border-black/10 bg-[#FC6719] px-4 py-3 text-white">
                        {!zwiftLogoFailed ? (
                            <img
                                src="/zwift/zwiftlink-logo-lockups-generic-horizonal.png"
                                alt="Zwift Link partner lockup"
                                className="h-10 w-auto object-contain"
                                onError={() => setZwiftLogoFailed(true)}
                            />
                        ) : (
                            <div className="flex items-center justify-between gap-3">
                                <div className="text-sm font-semibold tracking-wide">ZWIFT</div>
                                <div className="text-sm font-bold">x</div>
                                <div className="text-sm font-semibold tracking-wide">DCU</div>
                            </div>
                        )}
                    </div>
                    <div className="mb-4">
                        <p className="text-sm text-muted-foreground">
                            Forbind din konto via <strong>Zwift Link</strong>. Ifolge Zwift guidelines bruges Zwift Orange
                            (#FC6719) som primar farve i denne integration.
                        </p>
                    </div>

                    {zwiftConnected ? (
                        <div className="flex items-center justify-between bg-white dark:bg-black/20 p-4 rounded border border-border">
                            <div className="flex items-center gap-2 text-green-600 dark:text-green-400 font-medium">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                                Forbundet til Zwift (officiel API)
                            </div>
                            <button
                                onClick={handleDisconnectZwift}
                                className="text-sm text-red-600 hover:text-red-700 hover:underline"
                            >
                                Frakobl
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={handleConnectZwift}
                            className="px-4 py-2 rounded-lg bg-[#FC6719] text-white hover:brightness-95 font-medium border border-[#FC6719] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FC6719] focus-visible:ring-offset-2"
                        >
                            Connect with Zwift Link
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
                            Forbind Strava, så admins kan validere dobbeltregistrering ved behov.
                        </p>
                    </div>

                    {stravaConnected ? (
                        <div className="flex items-center justify-between bg-white dark:bg-black/20 p-4 rounded border border-border">
                            <div className="flex items-center gap-2 text-green-600 dark:text-green-400 font-medium">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                                Forbundet til Strava (admin-validering)
                            </div>
                            <button
                                onClick={handleDisconnectStrava}
                                className="text-sm text-red-600 hover:text-red-700 hover:underline"
                            >
                                Frakobl
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center justify-between gap-4">
                            <button
                                onClick={handleConnectStrava}
                                className="inline-flex items-center justify-start rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
        </div>
    );
}
