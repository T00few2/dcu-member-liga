'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';

export default function WelcomeModal() {
    const { user, isRegistered, loading, hasSeenWelcomeModal, refreshProfile } = useAuth();
    const [isOpen, setIsOpen] = useState(false);
    const [dontShowAgain, setDontShowAgain] = useState(false);
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        if (!loading && user && isRegistered) {
            if (!hasSeenWelcomeModal) {
                setIsOpen(true);
            }
        }
    }, [user, isRegistered, loading, hasSeenWelcomeModal]);

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

    const handleClose = async () => {
        if (dontShowAgain && user) {
            try {
                const token = await user.getIdToken();
                const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
                await fetch(`${apiUrl}/welcome-seen`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
                await refreshProfile();
            } catch (error) {
                console.error('Failed to update welcome modal preference', error);
            }
        }
        setIsOpen(false);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 sm:mt-0 pt-[10vh]">
            {/* Backdrop */}
            <div
                className={`fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
                onClick={handleClose}
            ></div>

            {/* Modal Content */}
            <div
                className={`relative w-full max-w-2xl bg-card text-card-foreground rounded-2xl shadow-2xl overflow-hidden transform transition-all duration-300 flex flex-col max-h-[90vh] sm:max-h-[85vh] ${isVisible ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 translate-y-4'}`}
            >
                {/* Header Decoration */}
                <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-primary via-primary-dark to-primary"></div>

                {/* Close Button */}
                <button
                    onClick={handleClose}
                    className="absolute top-4 right-4 p-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-full transition-colors z-10"
                    aria-label="Close"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                <div className="p-6 sm:p-8 overflow-y-auto">
                    <h2 className="text-xl sm:text-2xl font-bold mb-2 pr-8 text-foreground">Velkommen til platformen</h2>

                    <p className="text-muted-foreground text-sm mb-5 leading-relaxed">
                        Denne webapplikation er bygget til at samle alt omkring DCU forårsliga ét sted, så du nemt kan få overblik over sæsonen.
                    </p>

                    {/* Features Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
                        <div className="flex gap-3 bg-muted/10 p-3.5 rounded-xl border border-border/50 hover:bg-muted/20 transition-colors">
                            <div className="text-primary mt-0.5">
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                            </div>
                            <div>
                                <h3 className="font-semibold text-sm text-foreground mb-0.5">Løbskalender</h3>
                                <p className="text-xs text-muted-foreground">Se rutedetaljer for kommende løb og få direkte links til Zwift-tilmelding.</p>
                            </div>
                        </div>

                        <div className="flex gap-3 bg-muted/10 p-3.5 rounded-xl border border-border/50 hover:bg-muted/20 transition-colors">
                            <div className="text-primary mt-0.5">
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
                            </div>
                            <div>
                                <h3 className="font-semibold text-sm text-foreground mb-0.5">Resultater & Stilling</h3>
                                <p className="text-xs text-muted-foreground">Følg med i stilling for både hold og individuelle.</p>
                            </div>
                        </div>

                        <div className="flex gap-3 bg-muted/10 p-3.5 rounded-xl border border-border/50 hover:bg-muted/20 transition-colors">
                            <div className="text-primary mt-0.5">
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
                            </div>
                            <div>
                                <h3 className="font-semibold text-sm text-foreground mb-0.5">Rytterstatistik</h3>
                                <p className="text-xs text-muted-foreground">Slå alle deltagere op og dyk ned i data.</p>
                            </div>
                        </div>

                        <div className="flex gap-3 bg-muted/10 p-3.5 rounded-xl border border-border/50 hover:bg-muted/20 transition-colors">
                            <div className="text-primary mt-0.5">
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                            </div>
                            <div>
                                <h3 className="font-semibold text-sm text-foreground mb-0.5">Min Profil</h3>
                                <p className="text-xs text-muted-foreground">Hold dine stamdata, klubvalg og samtykker opdaterede ét centralt sted.</p>
                            </div>
                        </div>
                    </div>

                    {/* Placeholder for future video */}
                    <div className="w-full aspect-video bg-muted/20 border border-border/50 rounded-xl flex items-center justify-center mb-6 shadow-inner relative overflow-hidden group">
                        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent"></div>
                        <div className="text-muted-foreground flex flex-col items-center gap-3 relative z-10">
                            <div className="w-14 h-14 bg-background/80 rounded-full flex items-center justify-center shadow-sm -ml-1">
                                <svg className="w-8 h-8 text-primary/60 ml-1" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M8 5v14l11-7z" />
                                </svg>
                            </div>
                            <span className="text-sm font-medium tracking-wide">Introduktionsvideo kommer her</span>
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-border pt-6">
                        <label className="flex items-center gap-3 cursor-pointer group">
                            <div className="relative flex items-center">
                                <input
                                    type="checkbox"
                                    className="peer h-5 w-5 cursor-pointer appearance-none rounded border border-border bg-background transition-all checked:border-primary checked:bg-primary"
                                    checked={dontShowAgain}
                                    onChange={(e) => setDontShowAgain(e.target.checked)}
                                />
                                <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-primary-foreground opacity-0 transition-opacity peer-checked:opacity-100">
                                    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                    </svg>
                                </div>
                            </div>
                            <span className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                                Vis ikke denne besked igen
                            </span>
                        </label>

                        <button
                            onClick={handleClose}
                            className="bg-primary text-primary-foreground px-6 py-2.5 rounded-lg font-bold hover:bg-primary-dark transition-all w-full sm:w-auto shadow-md hover:shadow-lg focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-background outline-none"
                        >
                            Start med at udforske
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
