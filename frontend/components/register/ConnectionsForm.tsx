'use client';

import StravaAttribution from '@/components/StravaAttribution';

interface ConnectionsFormProps {
    stravaConnected: boolean;
    handleConnectStrava: () => void;
    handleDisconnectStrava: () => void;
}

export default function ConnectionsForm({
    stravaConnected, handleConnectStrava, handleDisconnectStrava
}: ConnectionsFormProps) {
    return (
        <div className="space-y-8">
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
