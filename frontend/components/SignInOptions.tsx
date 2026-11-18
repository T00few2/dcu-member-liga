'use client';

import { useEffect, useState } from 'react';
import { isInAppBrowser } from '@/lib/browser-detection';

interface SignInOptionsProps {
    /** Primary action: sign in with Zwift (full-page redirect). */
    onZwift: () => void | Promise<void>;
    /** Secondary action: Google popup. Hidden in in-app browsers, where Google blocks it. */
    onGoogle: () => void;
    zwiftLabel?: string;
    googleLabel?: string;
}

export default function SignInOptions({
    onZwift,
    onGoogle,
    zwiftLabel = 'Log ind med Zwift',
    googleLabel = 'Log ind med Google',
}: SignInOptionsProps) {
    const [inAppBrowser, setInAppBrowser] = useState(false);
    const [redirecting, setRedirecting] = useState(false);

    useEffect(() => {
        setInAppBrowser(isInAppBrowser());
    }, []);

    const handleZwift = async () => {
        setRedirecting(true);
        try {
            await onZwift();
        } finally {
            // Stays "redirecting" while the browser leaves; reset if it didn't.
            setTimeout(() => setRedirecting(false), 4000);
        }
    };

    return (
        <div className="flex flex-col gap-3">
            <button
                type="button"
                onClick={handleZwift}
                disabled={redirecting}
                className="w-full bg-[#FC6719] text-white py-3.5 px-4 rounded-xl font-bold hover:bg-[#e55a10] disabled:opacity-70 transition-all shadow-md hover:shadow-lg"
            >
                {redirecting ? 'Sender dig til Zwift…' : zwiftLabel}
            </button>
            <p className="text-xs text-center text-muted-foreground">
                Brug din Zwift-konto. Du skal ikke oprette en ny adgangskode.
            </p>
            {inAppBrowser ? (
                <p className="text-xs text-center text-muted-foreground">
                    Google-login virker ikke i Facebook / Messengers browser. Brug Zwift, eller åbn siden i Safari eller Chrome.
                </p>
            ) : (
                <button
                    type="button"
                    onClick={onGoogle}
                    className="w-full border border-border text-foreground hover:bg-muted py-2.5 px-4 rounded-xl font-medium transition-all"
                >
                    {googleLabel}
                </button>
            )}
        </div>
    );
}
