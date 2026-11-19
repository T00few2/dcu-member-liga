'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';

interface EmailVerificationStepProps {
    initialEmail?: string;
    onVerified: (email: string) => void;
}

/**
 * Email for riders who signed in with Zwift (Zwift doesn't share an email).
 * The rider enters an address, gets a 6-digit code by email and confirms it.
 */
export default function EmailVerificationStep({ initialEmail = '', onVerified }: EmailVerificationStepProps) {
    const { user } = useAuth();
    const [email, setEmail] = useState(initialEmail);
    const [code, setCode] = useState('');
    const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [cooldown, setCooldown] = useState(0);

    useEffect(() => {
        if (cooldown <= 0) return;
        const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
        return () => clearTimeout(t);
    }, [cooldown]);

    const post = async (path: string, body: object) => {
        const token = await user?.getIdToken();
        const res = await fetch(`${API_URL}${path}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok, data };
    };

    const sendCode = async () => {
        setError(null);
        setBusy(true);
        try {
            const { ok, data } = await post('/profile/email/send-code', { email });
            if (!ok) {
                setError(data.message || 'Kunne ikke sende koden.');
                if (data.retryAfter) setCooldown(Number(data.retryAfter));
                return;
            }
            setCodeSentTo(data.email || email);
            setCode('');
            setCooldown(60);
        } catch {
            setError('Kunne ikke sende koden. Prøv igen.');
        } finally {
            setBusy(false);
        }
    };

    const verify = async () => {
        setError(null);
        setBusy(true);
        try {
            const { ok, data } = await post('/profile/email/verify', { code });
            if (!ok) {
                setError(data.message || 'Koden kunne ikke bekræftes.');
                return;
            }
            onVerified(data.email);
        } catch {
            setError('Koden kunne ikke bekræftes. Prøv igen.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="rounded-lg border border-border p-4 space-y-3" data-testid="email-verification">
            <div>
                <h3 className="font-semibold text-card-foreground">Email</h3>
                <p className="text-sm text-muted-foreground">
                    Zwift deler ikke din email med os. Vi bruger den til at kontakte dig om løb og din tilmelding.
                </p>
            </div>

            {!codeSentTo ? (
                <div className="flex flex-col sm:flex-row gap-2">
                    <label htmlFor="reg-email" className="sr-only">Email</label>
                    <input
                        id="reg-email"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="din@email.dk"
                        className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-input bg-background text-foreground"
                    />
                    <button
                        type="button"
                        onClick={sendCode}
                        disabled={busy || !email.trim() || cooldown > 0}
                        className="px-4 py-2 bg-primary text-primary-foreground font-bold rounded-lg disabled:opacity-50"
                    >
                        {busy ? 'Sender…' : 'Send kode'}
                    </button>
                </div>
            ) : (
                <div className="space-y-2">
                    <p className="text-sm text-foreground">
                        Vi har sendt en kode til <strong>{codeSentTo}</strong>. Tjek evt. dit spamfilter.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2">
                        <label htmlFor="reg-email-code" className="sr-only">Bekræftelseskode</label>
                        <input
                            id="reg-email-code"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            maxLength={6}
                            value={code}
                            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                            placeholder="6 cifre"
                            className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-input bg-background text-foreground tracking-widest"
                        />
                        <button
                            type="button"
                            onClick={verify}
                            disabled={busy || code.length !== 6}
                            className="px-4 py-2 bg-primary text-primary-foreground font-bold rounded-lg disabled:opacity-50"
                        >
                            {busy ? 'Bekræfter…' : 'Bekræft'}
                        </button>
                    </div>
                    <div className="flex gap-4 text-sm">
                        <button
                            type="button"
                            onClick={sendCode}
                            disabled={busy || cooldown > 0}
                            className="text-muted-foreground hover:text-foreground underline disabled:no-underline disabled:opacity-60"
                        >
                            {cooldown > 0 ? `Send ny kode (${cooldown}s)` : 'Send ny kode'}
                        </button>
                        <button
                            type="button"
                            onClick={() => { setCodeSentTo(null); setError(null); }}
                            className="text-muted-foreground hover:text-foreground underline"
                        >
                            Ret email
                        </button>
                    </div>
                </div>
            )}

            {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
        </div>
    );
}
