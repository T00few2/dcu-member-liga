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
                <h3 className="text-lg font-semibold mb-3 text-card-foreground">Strava Connection</h3>
                <div className={`p-4 border rounded-lg transition-colors ${stravaConnected ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800' : 'bg-card border-border'}`}>

                    <div className="flex items-center justify-between mb-4">
                        <p className="text-sm text-muted-foreground">
                            Connect Strava to automatically import your race results.
                        </p>
                        <StravaAttribution />
                    </div>

                    {stravaConnected ? (
                        <div className="flex items-center justify-between bg-white dark:bg-black/20 p-4 rounded border border-border">
                            <div className="flex items-center gap-2 text-green-600 dark:text-green-400 font-medium">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                                Connected to Strava
                            </div>
                            <button
                                onClick={handleDisconnectStrava}
                                className="text-sm text-red-600 hover:text-red-700 hover:underline"
                            >
                                Disconnect
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={handleConnectStrava}
                            className="w-full flex items-center justify-center gap-2 bg-[#FC4C02] text-white px-4 py-3 rounded-lg font-bold hover:bg-[#E34402] transition-colors shadow-sm"
                        >
                            <svg role="img" viewBox="0 0 24 24" className="w-5 h-5 fill-current"><title>Strava</title><path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" /></svg>
                            Connect with Strava
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
