'use client';

import { useEffect } from 'react';
import SignInOptions from '@/components/SignInOptions';
import { useAuth } from '@/lib/auth-context';

interface SignInModalProps {
    isOpen: boolean;
    onClose: () => void;
}

/** "Log ind": Zwift, plus a small Google link for riders who used Google before. */
export default function SignInModal({ isOpen, onClose }: SignInModalProps) {
    const { signInWithZwift, signInWithGoogle } = useAuth();

    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="sign-in-title">
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-full max-w-sm bg-card text-card-foreground rounded-2xl shadow-2xl overflow-hidden">
                <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-primary via-primary-dark to-primary" />
                <button
                    onClick={onClose}
                    className="absolute top-3 right-3 p-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-full transition-colors"
                    aria-label="Luk"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
                <div className="p-6 pt-8">
                    <h2 id="sign-in-title" className="text-xl font-bold text-center mb-5">Log ind</h2>
                    <SignInOptions
                        onZwift={() => signInWithZwift('login')}
                        onGoogle={() => { onClose(); signInWithGoogle('login'); }}
                    />
                </div>
            </div>
        </div>
    );
}
