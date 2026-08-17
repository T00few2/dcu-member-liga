'use client';

import { useEffect, useState } from 'react';

interface ConfirmUnsignupModalProps {
    isOpen: boolean;
    raceName: string;
    raceDateLabel?: string;
    categoryHint?: string | null;
    isLoading?: boolean;
    onConfirm: () => void;
    onClose: () => void;
}

export default function ConfirmUnsignupModal({
    isOpen,
    raceName,
    raceDateLabel,
    categoryHint,
    isLoading = false,
    onConfirm,
    onClose,
}: ConfirmUnsignupModalProps) {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setIsVisible(true);
            document.body.style.overflow = 'hidden';
        } else {
            setIsVisible(false);
            document.body.style.overflow = 'unset';
        }
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !isLoading) onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isOpen, isLoading, onClose]);

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 sm:mt-0 pt-[10vh]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-unsignup-title"
        >
            <div
                className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"
                onClick={isLoading ? undefined : onClose}
            ></div>

            <div
                className={`relative w-full max-w-md bg-card text-card-foreground rounded-2xl shadow-2xl overflow-hidden transform transition-all duration-300 ${
                    isVisible ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 translate-y-4'
                }`}
            >
                <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-red-500 to-orange-500"></div>

                <div className="p-6 sm:p-8">
                    <div className="text-center mb-6">
                        <div className="mx-auto w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mb-4">
                            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500" aria-hidden>
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="15" y1="9" x2="9" y2="15"></line>
                                <line x1="9" y1="9" x2="15" y2="15"></line>
                            </svg>
                        </div>
                        <h2 id="confirm-unsignup-title" className="text-2xl font-bold mb-2">
                            Afmeld løb?
                        </h2>
                        <p className="text-muted-foreground text-sm leading-relaxed">
                            Du fjernes fra <span className="font-semibold text-card-foreground">{raceName}</span>
                            {raceDateLabel ? ` ${raceDateLabel}` : ''}
                            {categoryHint ? ` (${categoryHint})` : ''}. Du kan tilmelde dig igen frem til start.
                        </p>
                    </div>

                    <div className="flex flex-col gap-3">
                        <button
                            onClick={onConfirm}
                            disabled={isLoading}
                            className="w-full bg-red-600 hover:bg-red-700 text-white py-3 px-4 rounded-xl font-bold transition-all shadow-md hover:shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {isLoading ? 'Afmelder...' : 'Ja, afmeld mig'}
                        </button>
                        <button
                            onClick={onClose}
                            disabled={isLoading}
                            className="w-full border border-border text-foreground hover:bg-muted py-3 px-4 rounded-xl font-medium transition-all disabled:opacity-60"
                        >
                            Behold tilmelding
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
