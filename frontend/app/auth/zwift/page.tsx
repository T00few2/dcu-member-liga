'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';

const ERROR_MESSAGES: Record<string, string> = {
    access_denied: 'Du afbrød login hos Zwift.',
    expired_state: 'Login tog for lang tid. Prøv igen.',
    expired_code: 'Login-linket er udløbet. Prøv igen.',
    invalid_code: 'Login-linket er udløbet eller allerede brugt. Prøv igen.',
    token_exchange_failed: 'Zwift-login fejlede. Prøv igen.',
    missing_zwift_id: 'Vi kunne ikke læse dit Zwift ID. Prøv igen.',
};

function ZwiftSignInContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { user, loading, isRegistered, profileLoaded, completeZwiftSignIn, signInWithZwift } = useAuth();
    const code = searchParams.get('code');
    const errorParam = searchParams.get('error');
    const [error, setError] = useState<string | null>(
        errorParam ? (ERROR_MESSAGES[errorParam] || 'Login med Zwift fejlede. Prøv igen.') : null,
    );
    const [signedIn, setSignedIn] = useState(false);
    const started = useRef(false);

    // Swap the one-time code for a Firebase custom token, then sign in.
    useEffect(() => {
        if (!code || errorParam || started.current) return;
        started.current = true;
        (async () => {
            try {
                const res = await fetch(`${API_URL}/auth/zwift/exchange`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.customToken) {
                    setError(ERROR_MESSAGES[data.code] || data.message || 'Login med Zwift fejlede. Prøv igen.');
                    return;
                }
                const intent = data.intent === 'register' || data.intent === 'login' ? data.intent : null;
                await completeZwiftSignIn(data.customToken, intent);
                setSignedIn(true);
            } catch (e) {
                console.error('Zwift sign-in failed', e);
                setError('Login med Zwift fejlede. Prøv igen.');
            }
        })();
    }, [code, errorParam, completeZwiftSignIn]);

    // Once the profile is known, go on: unregistered riders finish registration,
    // registered riders go to the front page.
    useEffect(() => {
        if (!signedIn || loading || !user || !profileLoaded) return;
        router.replace(isRegistered ? '/' : '/register');
    }, [signedIn, loading, user, profileLoaded, isRegistered, router]);

    if (error) {
        return (
            <div className="max-w-md mx-auto mt-16 p-8 bg-card rounded-lg shadow-md border border-border text-center">
                <h1 className="text-2xl font-bold mb-3 text-card-foreground">Login med Zwift</h1>
                <p className="text-red-600 dark:text-red-400 mb-6" role="alert">{error}</p>
                <div className="flex flex-col gap-3">
                    <button
                        onClick={() => signInWithZwift('login')}
                        className="w-full bg-primary text-primary-foreground py-3 px-4 rounded-xl font-bold hover:bg-primary-dark"
                    >
                        Prøv igen
                    </button>
                    <Link href="/" className="text-sm text-muted-foreground hover:text-foreground underline">
                        Til forsiden
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center justify-center gap-4 mt-24" aria-live="polite">
            <div className="w-12 h-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
            <p className="text-muted-foreground text-sm font-medium">Logger ind med Zwift…</p>
        </div>
    );
}

export default function ZwiftSignInPage() {
    return (
        <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Indlæser...</div>}>
            <ZwiftSignInContent />
        </Suspense>
    );
}
