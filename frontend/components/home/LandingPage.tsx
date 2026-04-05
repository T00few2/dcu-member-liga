'use client';

import { useState, useEffect } from 'react';
import ECyclingClubsModal from '@/components/ECyclingClubsModal';
import CodeOfConductModal from '@/components/CodeOfConductModal';
import RegistrationIntroModal from '@/components/RegistrationIntroModal';
import UnregisteredLoginModal from '@/components/UnregisteredLoginModal';
import CommunitySection from './CommunitySection';
import { API_URL } from '@/lib/api';

interface LandingPageProps {
    showUnregisteredModal: boolean;
    isRegistered: boolean;
    onSignInWithGoogle: () => void;
    onCloseUnregisteredModal: () => void;
    onStartRegistration: () => Promise<void>;
}

export default function LandingPage({
    showUnregisteredModal,
    isRegistered,
    onSignInWithGoogle,
    onCloseUnregisteredModal,
    onStartRegistration,
}: LandingPageProps) {
    const [showClubsModal, setShowClubsModal] = useState(false);
    const [showCoCModal, setShowCoCModal] = useState(false);
    const [showRegIntroModal, setShowRegIntroModal] = useState(false);
    const [memberCount, setMemberCount] = useState<number | null>(null);

    useEffect(() => {
        fetch(`${API_URL}/public/member-count`)
            .then(r => r.ok ? r.json() : null)
            .then(d => d?.memberCount != null && setMemberCount(d.memberCount))
            .catch(() => {});
    }, []);

    return (
        <div className="w-full relative -mt-4 text-foreground bg-background">
            {/* Hero */}
            <div className="relative w-full min-h-[85vh] flex flex-col items-center justify-center overflow-hidden bg-black">
                <video autoPlay loop muted playsInline preload="auto" className="absolute inset-0 w-full h-full object-cover z-0 opacity-50 mix-blend-screen bg-black">
                    <source src="/hero-video.mp4" type="video/mp4" />
                </video>
                <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/50 to-background/95 z-0"></div>
                <div className="absolute top-1/4 left-1/4 w-[30rem] h-[30rem] bg-primary/20 rounded-full mix-blend-screen filter blur-[120px] animate-pulse z-0"></div>
                <div className="absolute bottom-1/4 right-1/4 w-[30rem] h-[30rem] bg-white/10 rounded-full mix-blend-screen filter blur-[120px] animate-pulse [animation-delay:2s] z-0"></div>

                <div className="relative z-10 flex flex-col items-center text-center px-4 mt-16 max-w-5xl mx-auto">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/20 text-primary border border-primary/30 text-sm font-medium mb-8 backdrop-blur-sm animate-in fade-in slide-in-from-bottom-4 duration-1000">
                        <span className="relative flex h-2.5 w-2.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary"></span>
                        </span>
                        Officiel E-Cykling Liga
                    </div>
                    <h1 className="text-5xl md:text-7xl font-extrabold mb-6 tracking-tight text-white drop-shadow-lg pb-2 animate-in fade-in zoom-in-95 duration-1000 delay-150 fill-mode-both">
                        Velkommen til <br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-white">DCU forårsliga</span>
                    </h1>
                    <p className="text-xl md:text-2xl max-w-2xl text-slate-300 drop-shadow animate-in fade-in slide-in-from-bottom-4 duration-1000 delay-300 fill-mode-both font-light">
                        Den førende kompetitive virtuelle cykeloplevelse for alle medlemmer af Danmarks Cykle Union.
                    </p>

                    {memberCount !== null && (
                        <div className="mt-8 animate-in fade-in slide-in-from-bottom-4 duration-1000 delay-500 fill-mode-both">
                            <div className="inline-flex items-center gap-2.5 px-5 py-2.5 rounded-full bg-white/10 border border-white/20 backdrop-blur-sm text-white/80 text-sm font-medium">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-70">
                                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                                    <circle cx="9" cy="7" r="4" />
                                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                                </svg>
                                <span><span className="font-bold text-white">{memberCount}</span> ryttere tilmeldt</span>
                            </div>
                        </div>
                    )}
                </div>

                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center text-white/50 animate-bounce">
                    <span className="text-xs uppercase tracking-widest mb-2 font-medium">Læs mere</span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M19 12l-7 7-7-7" /></svg>
                </div>
            </div>

            {/* Action Cards */}
            <div className="container mx-auto px-4 -mt-24 relative z-20 pb-20 animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-500 fill-mode-both">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-4xl mx-auto">
                    <div className="bg-card/80 backdrop-blur-md border border-border/50 text-card-foreground p-8 rounded-2xl shadow-2xl flex flex-col hover:-translate-y-1 hover:shadow-primary/10 transition-all duration-300 relative overflow-hidden group text-left text-base">
                        <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity z-0 pointer-events-none"></div>
                        <h2 className="text-2xl font-bold mb-3 relative z-10">Ikke medlem af en klub endnu?</h2>
                        <p className="text-muted-foreground mb-8 flex-grow relative z-10">
                            Deltagelse kræver medlemskab af en DCU-klub. Vælg mellem en dedikeret E-cykelklub eller en fysisk cykelklub.
                        </p>
                        <button
                            onClick={() => setShowClubsModal(true)}
                            className="w-full bg-secondary text-secondary-foreground py-3.5 px-4 rounded-xl font-semibold hover:bg-secondary/80 transition-all flex items-center justify-center gap-2 border border-border relative z-10"
                        >
                            Find en DCU-klub &rarr;
                        </button>
                    </div>

                    <div className="bg-gradient-to-br from-card/95 to-card/80 backdrop-blur-xl border border-primary/30 text-card-foreground p-8 rounded-2xl shadow-2xl flex flex-col hover:-translate-y-1 hover:shadow-primary/20 transition-all duration-300 relative overflow-hidden group text-left text-base">
                        <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                        <div className="absolute -right-10 -top-10 w-32 h-32 bg-primary/20 rounded-full blur-3xl"></div>
                        <h2 className="text-2xl font-bold mb-3 text-foreground">Allerede medlem af DCU-klub?</h2>
                        <p className="text-muted-foreground mb-8 flex-grow">
                            Log ind med din Google-konto og registrer for at deltage.
                        </p>
                        <button
                            onClick={() => setShowRegIntroModal(true)}
                            className="w-full bg-primary text-primary-foreground py-3.5 px-4 rounded-xl font-bold hover:shadow-[0_0_20px_rgba(192,4,24,0.4)] hover:-translate-y-0.5 transition-all flex items-center justify-center gap-3 relative overflow-hidden"
                        >
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full hover:animate-[shimmer_1.5s_infinite]"></div>
                            <span className="relative z-10">Tilmeld dig</span>
                        </button>
                    </div>
                </div>
            </div>

            <CommunitySection onShowCoCModal={() => setShowCoCModal(true)} />

            <ECyclingClubsModal isOpen={showClubsModal} onClose={() => setShowClubsModal(false)} />
            <CodeOfConductModal isOpen={showCoCModal} onClose={() => setShowCoCModal(false)} />
            <RegistrationIntroModal
                isOpen={showRegIntroModal}
                onClose={() => setShowRegIntroModal(false)}
                onContinue={onSignInWithGoogle}
            />
            <UnregisteredLoginModal
                isOpen={showUnregisteredModal}
                onClose={onCloseUnregisteredModal}
                onStartRegistration={onStartRegistration}
            />
        </div>
    );
}
