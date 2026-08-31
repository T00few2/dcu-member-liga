'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import Link from 'next/link';
import WeightVideoSubmitForm from '@/components/WeightVideoSubmitForm';
import { useLeagueSettingsQuery } from '@/hooks/queries/useLeagueSettingsQuery';

export default function WeightVerificationModal() {
    const { user, weightVerificationStatus, refreshProfile, loading } = useAuth();
    const { data: leagueSettings } = useLeagueSettingsQuery();
    const [isOpen, setIsOpen] = useState(false);
    const [success, setSuccess] = useState(false);

    const validDays = Number(leagueSettings?.weightVerificationValidDays) > 0
        ? Number(leagueSettings?.weightVerificationValidDays)
        : 30;

    useEffect(() => {
        if (loading) return;

        // Sampled pending only — do not auto-open for voluntary or rejected uploads.
        const shouldShow = user && weightVerificationStatus === 'pending';

        if (shouldShow) {
            const dismissed = sessionStorage.getItem('weightVerificationDismissed');
            if (!dismissed) {
                setIsOpen(true);
            }
        } else {
            setIsOpen(false);
        }
    }, [user, weightVerificationStatus, loading]);

    const handleDismiss = () => {
        setIsOpen(false);
        sessionStorage.setItem('weightVerificationDismissed', 'true');
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow-xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200 dark:border-slate-700">
                <div className="p-4 border-b bg-orange-50 border-orange-100 dark:bg-orange-900/20 dark:border-orange-900">
                    <h2 className="text-lg font-bold flex items-center gap-2 text-orange-700 dark:text-orange-400">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
                        </svg>
                        Vægtbekræftelse Påkrævet
                    </h2>
                </div>

                <div className="p-6 space-y-4">
                    <p className="text-slate-600 dark:text-slate-300 text-sm">
                        Du er blevet udtrukket til en stikprøve af din vægt. Indsend venligst en video af din indvejning for at fortsætte med at køre race.
                    </p>

                    {!success ? (
                        <div className="space-y-4">
                            <WeightVideoSubmitForm
                                compact
                                validDays={validDays}
                                submitLabel="Indsend Bekræftelse"
                                onSubmitted={() => {
                                    setSuccess(true);
                                    void refreshProfile();
                                    setTimeout(() => setIsOpen(false), 2000);
                                }}
                            />
                            <button
                                type="button"
                                onClick={handleDismiss}
                                className="w-full px-4 py-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 font-medium transition-colors"
                            >
                                Senere
                            </button>
                        </div>
                    ) : (
                        <div className="text-center py-4 space-y-4">
                            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-600">
                                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                            </div>
                            <h3 className="text-lg font-medium text-slate-900 dark:text-white">
                                Indsendt!
                            </h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                Tak for din bekræftelse. En administrator vil gennemgå din video snarest.
                            </p>
                        </div>
                    )}
                </div>

                {!success && (
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-3 text-center border-t border-slate-100 dark:border-slate-800">
                        <Link href="/verification" className="text-xs text-primary hover:underline" onClick={() => setIsOpen(false)}>
                            Se vejledning til bekræftelse
                        </Link>
                    </div>
                )}
            </div>
        </div>
    );
}
