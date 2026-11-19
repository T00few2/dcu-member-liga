'use client';

import React, { useEffect, useState } from 'react';
import SignInOptions from '@/components/SignInOptions';

interface RegistrationIntroModalProps {
    isOpen: boolean;
    onClose: () => void;
    onContinueWithZwift: () => void | Promise<void>;
}

export default function RegistrationIntroModal({ isOpen, onClose, onContinueWithZwift }: RegistrationIntroModalProps) {
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

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 sm:mt-0 pt-[10vh]">
            {/* Backdrop */}
            <div
                className={`fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
                onClick={onClose}
            ></div>

            {/* Modal Content */}
            <div
                className={`relative w-full max-w-lg bg-card text-card-foreground rounded-2xl shadow-2xl overflow-hidden transform transition-all duration-300 ${isVisible ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 translate-y-4'}`}
            >
                {/* Header Decoration */}
                <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-primary via-primary-dark to-primary"></div>

                {/* Close Button */}
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 p-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-full transition-colors"
                    aria-label="Close"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                <div className="p-8">
                    <div className="text-center mb-8">
                        <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
                                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
                                <circle cx="9" cy="7" r="4"></circle>
                                <path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>
                                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                            </svg>
                        </div>
                        <h2 className="text-2xl sm:text-3xl font-bold mb-2">Klar til at køre med?</h2>
                        <p className="text-muted-foreground text-sm sm:text-base">
                            Oprettelsen tager kun 2 minutter. For at deltage i ligaen beder vi dig gennemføre tre hurtige trin:
                        </p>
                    </div>

                    <div className="space-y-6 mb-8">
                        {/* Step 1 */}
                        <div className="flex gap-4">
                            <div className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold border border-primary/20 text-sm">
                                1
                            </div>
                            <div>
                                <h3 className="font-semibold mb-1 text-foreground">Rytterinfo</h3>
                                <p className="text-sm text-muted-foreground">Fortæl os lidt om dig selv, din DCU-klub og dit udstyr.</p>
                            </div>
                        </div>

                        {/* Step 2 */}
                        <div className="flex gap-4">
                            <div className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold border border-primary/20 text-sm">
                                2
                            </div>
                            <div>
                                <h3 className="font-semibold mb-1 text-foreground">Forbindelser</h3>
                                <p className="text-sm text-muted-foreground">Forbind din konto til Zwift og Strava (begge er påkrævet).</p>
                            </div>
                        </div>

                        {/* Step 3 */}
                        <div className="flex gap-4">
                            <div className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold border border-primary/20 text-sm">
                                3
                            </div>
                            <div>
                                <h3 className="font-semibold mb-1 text-foreground">Aftaler</h3>
                                <p className="text-sm text-muted-foreground">Accepter vores regler for fair play, datapolitik og offentliggørelse.</p>
                            </div>
                        </div>
                    </div>

                    <div className="mt-8 border-t border-border pt-6">
                        <SignInOptions
                            onZwift={onContinueWithZwift}
                            zwiftLabel="Start tilmelding med Zwift"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
