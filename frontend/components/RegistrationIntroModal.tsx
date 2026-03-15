import React, { useEffect, useState } from 'react';

interface RegistrationIntroModalProps {
    isOpen: boolean;
    onClose: () => void;
    onContinue: () => void;
}

export default function RegistrationIntroModal({ isOpen, onClose, onContinue }: RegistrationIntroModalProps) {
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
                                <p className="text-sm text-muted-foreground">Forbind din konto til Zwift samt Strava til admin-validering ved behov.</p>
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
                        <p className="text-xs text-center text-muted-foreground mb-4">
                            Du logger ind via Google for at få en sikker konto.
                        </p>
                        <button
                            onClick={onContinue}
                            className="w-full bg-primary text-primary-foreground py-3.5 px-4 rounded-xl font-bold hover:bg-primary-dark transition-all flex items-center justify-center gap-3 relative overflow-hidden shadow-md hover:shadow-lg"
                        >
                            <svg className="w-5 h-5 relative z-10" viewBox="0 0 24 24">
                                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                            </svg>
                            <span className="relative z-10">Start tilmelding med Google</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
