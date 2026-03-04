'use client';

import { useAuth } from "@/lib/auth-context";
import Link from "next/link";
import { useEffect, useState } from "react";
import ECyclingClubsModal from '@/components/ECyclingClubsModal';
import CodeOfConductModal from '@/components/CodeOfConductModal';
import RegistrationIntroModal from '@/components/RegistrationIntroModal';
import WelcomeModal from '@/components/WelcomeModal';
import UnregisteredLoginModal from '@/components/UnregisteredLoginModal';
import { useRouter } from "next/navigation";

interface Segment {
    id: string;
    name: string;
    count: number;
    direction: string;
    lap: number;
    key?: string;
}

interface Race {
    id: string;
    name: string;
    date: string;
    routeId: string;
    routeName: string;
    map: string;
    laps: number;
    totalDistance: number;
    totalElevation: number;
    eventId?: string;
    eventSecret?: string;
    sprints?: Segment[];
    eventMode?: 'single' | 'multi';
    eventConfiguration?: {
        customCategory: string;
        laps?: number;
        sprints?: Segment[];
        eventId: string;
        eventSecret?: string;
    }[];
}

const getZwiftInsiderUrl = (routeName: string) => {
    if (!routeName) return '#';
    const slug = routeName.toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\w\-]+/g, '')
        .replace(/\-\-+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '');
    return `https://zwiftinsider.com/route/${slug}/`;
};

export default function Home() {
    const { user, signInWithGoogle, isRegistered, loading, logOut } = useAuth();
    const router = useRouter();
    const [nextRace, setNextRace] = useState<Race | null>(null);
    const [showClubsModal, setShowClubsModal] = useState(false);
    const [showCoCModal, setShowCoCModal] = useState(false);
    const [showRegIntroModal, setShowRegIntroModal] = useState(false);
    const [showUnregisteredModal, setShowUnregisteredModal] = useState(false);

    useEffect(() => {
        if (!loading && user && !isRegistered) {
            const intent = sessionStorage.getItem('authIntent');
            if (intent === 'login') {
                setShowUnregisteredModal(true);
                logOut();
            }
        }
    }, [user, isRegistered, loading, logOut]);

    useEffect(() => {
        const fetchNextRace = async () => {
            if (!user || !isRegistered) return;
            try {
                const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
                const token = await user.getIdToken();
                const res = await fetch(`${apiUrl}/races`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    const now = new Date();
                    const upcoming = (data.races || [])
                        .filter((r: Race) => new Date(r.date) > now)
                        .sort((a: Race, b: Race) => new Date(a.date).getTime() - new Date(b.date).getTime());

                    if (upcoming.length > 0) {
                        setNextRace(upcoming[0]);
                    }
                }
            } catch (e) {
                console.error('Error fetching next race', e);
            }
        };
        fetchNextRace();
    }, [user, isRegistered]);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="animate-pulse flex flex-col items-center gap-4">
                    <div className="w-12 h-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin"></div>
                    <p className="text-muted-foreground text-sm font-medium">Loading...</p>
                </div>
            </div>
        );
    }

    if (!user || !isRegistered) {
        return (
            <div className="w-full relative -mt-4 text-foreground bg-background">
                {/* Animated Hero Section with Video */}
                <div className="relative w-full min-h-[85vh] flex flex-col items-center justify-center overflow-hidden bg-black">
                    {/* Background Video */}
                    {/* For instant loading, place your video file at frontend/public/hero-video.mp4 */}
                    <video
                        autoPlay
                        loop
                        muted
                        playsInline
                        preload="auto"
                        className="absolute inset-0 w-full h-full object-cover z-0 opacity-50 mix-blend-screen bg-black"
                    >
                        <source src="/hero-video.mp4" type="video/mp4" />
                    </video>

                    {/* Gradient Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/50 to-background/95 z-0"></div>

                    {/* Dynamic CSS Shapes */}
                    <div className="absolute top-1/4 left-1/4 w-[30rem] h-[30rem] bg-primary/20 rounded-full mix-blend-screen filter blur-[120px] animate-pulse z-0"></div>
                    <div className="absolute bottom-1/4 right-1/4 w-[30rem] h-[30rem] bg-white/10 rounded-full mix-blend-screen filter blur-[120px] animate-pulse [animation-delay:2s] z-0"></div>

                    {/* Content */}
                    <div className="relative z-10 flex flex-col items-center text-center px-4 mt-16 max-w-5xl mx-auto">
                        {/* Badge */}
                        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/20 text-primary border border-primary/30 text-sm font-medium mb-8 backdrop-blur-sm animate-in fade-in slide-in-from-bottom-4 duration-1000">
                            <span className="relative flex h-2.5 w-2.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary"></span>
                            </span>
                            Officiel E-Cykling Liga
                        </div>

                        <h1 className="text-5xl md:text-7xl font-extrabold mb-6 tracking-tight text-white drop-shadow-lg pb-2 animate-in fade-in zoom-in-95 duration-1000 delay-150 fill-mode-both">
                            Velkommen til <br />
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-white">
                                DCU Member League
                            </span>
                        </h1>

                        <p className="text-xl md:text-2xl max-w-2xl text-slate-300 drop-shadow animate-in fade-in slide-in-from-bottom-4 duration-1000 delay-300 fill-mode-both font-light">
                            Den førende kompetitive virtuelle cykeloplevelse for alle medlemmer af Danmarks Cykle Union.
                        </p>
                    </div>

                    {/* Scroll Indicator */}
                    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center text-white/50 animate-bounce">
                        <span className="text-xs uppercase tracking-widest mb-2 font-medium">Læs mere</span>
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M19 12l-7 7-7-7" /></svg>
                    </div>
                </div>

                {/* Content Container moved up to overlap hero slightly */}
                <div className="container mx-auto px-4 -mt-24 relative z-20 pb-20 animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-500 fill-mode-both">
                    {/* Action Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-4xl mx-auto">
                        {/* Non-Member Card */}
                        <div className="bg-card/80 backdrop-blur-md border border-border/50 text-card-foreground p-8 rounded-2xl shadow-2xl flex flex-col hover:-translate-y-1 hover:shadow-primary/10 transition-all duration-300 relative overflow-hidden group text-left text-base">
                            <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity z-0 pointer-events-none"></div>
                            <h2 className="text-2xl font-bold mb-3 relative z-10">Ikke medlem af en klub endnu?</h2>
                            <p className="text-muted-foreground mb-8 flex-grow relative z-10">
                                Deltagelse kræver medlemskab af en DCU-klub. Vælg mellem en dedikeret E-cykling klub eller en fysisk cykelklub.
                            </p>

                            <button
                                onClick={() => setShowClubsModal(true)}
                                className="w-full bg-secondary text-secondary-foreground py-3.5 px-4 rounded-xl font-semibold hover:bg-secondary/80 transition-all flex items-center justify-center gap-2 border border-border relative z-10"
                            >
                                Find en DCU-klub &rarr;
                            </button>
                        </div>

                        {/* Member Card */}
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

                <div className="w-full py-24 px-4 bg-[#E7E3D6] text-slate-900 relative z-10 overflow-hidden mt-12">
                    {/* Decorative Sand Blob */}
                    <div className="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/4 w-[600px] h-[600px] sm:w-[800px] sm:h-[800px] bg-[#F1EFE7] rounded-full pointer-events-none z-0"></div>
                    <div className="absolute bottom-0 right-0 translate-x-1/3 translate-y-1/4 w-[400px] h-[400px] sm:w-[600px] sm:h-[600px] bg-[#F1EFE7] rounded-full pointer-events-none z-0"></div>

                    <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center relative z-20">
                        <div>
                            <h2 className="text-3xl md:text-4xl font-bold mb-6">Bliv en del af E-cykling fællesskabet</h2>
                            <p className="text-lg text-muted-foreground mb-6">
                                Oplev spændingen ved kompetitivt cykelløb fra din stue. DCU Member Ligaen forbinder ryttere på tværs af Danmark i organiserede, strukturerede og fair virtuelle løb på Zwift.
                            </p>
                            <div className="space-y-6 mb-8 text-base">
                                <div className="flex items-start gap-4">
                                    <div className="bg-primary/10 p-2.5 rounded-xl text-primary mt-1 shadow-sm">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                                    </div>
                                    <div>
                                        <h4 className="font-semibold text-lg text-foreground">Officielle DCU Cykelløb</h4>
                                        <p className="text-muted-foreground">Løbene følger de standardmæssige DCU-regulativer, tilpasset det virtuelle miljø for at sikre fair play.</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-4">
                                    <div className="bg-primary/10 p-2.5 rounded-xl text-primary mt-1 shadow-sm">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                                    </div>
                                    <div>
                                        <h4 className="font-semibold text-lg text-foreground">Klubrivaliseringer</h4>
                                        <p className="text-muted-foreground">Repræsentér din fysiske cykelklub og konkurrér i både individuelle og holdklassementer gennem hele sæsonen.</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                            {/* Social Links */}
                            <a href="https://www.facebook.com/groups/edcudk" target="_blank" rel="noopener noreferrer" className="p-6 rounded-2xl border border-border/60 bg-card/50 hover:bg-card hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/10 transition-all group flex flex-col justify-between h-44">
                                <div className="text-blue-500 mb-4 bg-blue-500/10 w-fit p-3 rounded-xl group-hover:scale-110 transition-transform">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" /></svg>
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-foreground group-hover:text-blue-500 transition-colors">Facebook Gruppe</h3>
                                    <p className="text-sm text-muted-foreground mt-1">Deltag i debatten</p>
                                </div>
                            </a>

                            <a href="https://discord.gg/your-discord-link" target="_blank" rel="noopener noreferrer" className="p-6 rounded-2xl border border-border/60 bg-card/50 hover:bg-card hover:border-indigo-500/50 hover:shadow-lg hover:shadow-indigo-500/10 transition-all group flex flex-col justify-between h-44">
                                <div className="text-indigo-500 mb-4 bg-indigo-500/10 w-fit p-3 rounded-xl group-hover:scale-110 transition-transform flex items-center justify-center" style={{ width: 52, height: 52 }}>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
                                    </svg>
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-foreground group-hover:text-indigo-500 transition-colors">Discord Server</h3>
                                    <p className="text-sm text-muted-foreground mt-1">Live løbschat & support</p>
                                </div>
                            </a>

                            <button
                                onClick={() => setShowCoCModal(true)}
                                className="p-6 rounded-2xl border border-border/60 bg-card/50 hover:bg-card hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10 transition-all group flex flex-col justify-between h-44 sm:col-span-2 text-left"
                            >
                                <div className="text-primary mb-4 bg-primary/10 w-fit p-3 rounded-xl group-hover:scale-110 transition-transform">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-foreground group-hover:text-primary transition-colors">DCU Code of Conduct</h3>
                                    <p className="text-sm text-muted-foreground mt-1">Læs reglerne for fair play, respekt og god sportsånd i ligaen.</p>
                                </div>
                            </button>
                        </div>
                    </div>
                </div>

                <ECyclingClubsModal isOpen={showClubsModal} onClose={() => setShowClubsModal(false)} />
                <CodeOfConductModal isOpen={showCoCModal} onClose={() => setShowCoCModal(false)} />
                <RegistrationIntroModal
                    isOpen={showRegIntroModal}
                    onClose={() => setShowRegIntroModal(false)}
                    onContinue={() => {
                        sessionStorage.setItem('authIntent', 'register');
                        signInWithGoogle();
                    }}
                />
                <UnregisteredLoginModal
                    isOpen={showUnregisteredModal}
                    onClose={() => {
                        sessionStorage.removeItem('authIntent');
                        setShowUnregisteredModal(false);
                    }}
                    onStartRegistration={() => {
                        sessionStorage.removeItem('authIntent');
                        setShowUnregisteredModal(false);
                        setShowRegIntroModal(true);
                    }}
                />
            </div >
        );
    }

    return (
        <div className="w-full relative -mt-4 text-foreground bg-background">
            {/* Animated Hero Section with Video for Logged In View */}
            <div className="relative w-full min-h-[50vh] flex flex-col items-center justify-center overflow-hidden bg-black pb-16 pt-8">
                <video autoPlay loop muted playsInline preload="auto" className="absolute inset-0 w-full h-full object-cover z-0 opacity-40 mix-blend-screen bg-black">
                    <source src="/hero-video.mp4" type="video/mp4" />
                </video>
                <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/50 to-background/95 z-0"></div>
                <div className="absolute top-1/4 left-1/4 w-[30rem] h-[30rem] bg-primary/20 rounded-full mix-blend-screen filter blur-[120px] animate-pulse z-0"></div>
                <div className="absolute bottom-1/4 right-1/4 w-[30rem] h-[30rem] bg-white/10 rounded-full mix-blend-screen filter blur-[120px] animate-pulse [animation-delay:2s] z-0"></div>

                <div className="relative z-10 flex flex-col items-center text-center px-4 mt-8 max-w-5xl mx-auto">
                    <h1 className="text-5xl md:text-6xl font-extrabold mb-4 tracking-tight text-white drop-shadow-lg pb-2 animate-in fade-in zoom-in-95 duration-1000">
                        Velkommen tilbage,<br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-white">
                            {user.displayName?.split(' ')[0] || 'Rytter'}
                        </span>
                    </h1>
                    <p className="text-xl mb-8 max-w-2xl text-slate-300 font-light drop-shadow animate-in fade-in slide-in-from-bottom-4 duration-1000 delay-150">
                        Dit dashboard for DCU Member League.
                    </p>
                </div>
            </div>

            {/* Content Container moved up to overlap hero slightly */}
            <div className="container mx-auto px-4 -mt-12 relative z-20 pb-20 animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-300">
                <div className="w-full max-w-4xl mx-auto space-y-8">
                    {nextRace && (
                        <div>
                            <div className="flex justify-between items-end mb-2">
                                <div className="text-primary text-sm font-bold uppercase tracking-wider">Næste Løb</div>
                                <Link
                                    href="/schedule"
                                    className="text-sm text-primary hover:underline"
                                >
                                    Se hele løbskalenderen &rarr;
                                </Link>
                            </div>
                            <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden p-6 text-left">
                                <div className="flex flex-col md:flex-row justify-between md:items-start gap-4 mb-4">
                                    <div>
                                        <div className="text-sm font-medium text-primary mb-1">
                                            {new Date(nextRace.date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                                        </div>
                                        <h3 className="text-2xl font-bold text-card-foreground">{nextRace.name}</h3>
                                        <div className="text-muted-foreground text-sm mt-1">
                                            Start: {new Date(nextRace.date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                                        </div>
                                    </div>
                                    <div className="bg-muted/30 px-4 py-2 rounded-lg text-right">
                                        <div className="font-semibold text-card-foreground">{nextRace.map}</div>
                                        <div className="text-sm text-muted-foreground flex items-center justify-end gap-1">
                                            {nextRace.routeName}
                                            <a
                                                href={getZwiftInsiderUrl(nextRace.routeName)}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-xs text-primary hover:underline"
                                                title="View on ZwiftInsider"
                                            >
                                                (Info ↗)
                                            </a>
                                        </div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-3 gap-4 mb-6 text-sm">
                                    <div className="bg-muted/20 p-3 rounded text-center">
                                        <div className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Distance</div>
                                        <div className="font-semibold text-card-foreground">{nextRace.totalDistance} km</div>
                                    </div>
                                    <div className="bg-muted/20 p-3 rounded text-center">
                                        <div className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Højdemeter</div>
                                        <div className="font-semibold text-card-foreground">{nextRace.totalElevation} m</div>
                                    </div>
                                    <div className="bg-muted/20 p-3 rounded text-center flex flex-col justify-center">
                                        <div className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Omgange</div>
                                        <div className="font-semibold text-card-foreground flex justify-center items-center h-full">
                                            {(() => {
                                                if (nextRace.eventMode === 'multi' && nextRace.eventConfiguration) {
                                                    const uniqueLaps = Array.from(new Set(nextRace.eventConfiguration.map(c => c.laps || nextRace.laps)));
                                                    if (uniqueLaps.length > 1) {
                                                        return (
                                                            <div className="flex flex-col text-xs">
                                                                {nextRace.eventConfiguration.map(c => (
                                                                    <span key={c.customCategory}>{c.customCategory}: {c.laps || nextRace.laps}</span>
                                                                ))}
                                                            </div>
                                                        );
                                                    } else if (uniqueLaps.length === 1 && uniqueLaps[0] !== nextRace.laps) {
                                                        return <>{uniqueLaps[0]}</>;
                                                    }
                                                }
                                                return <>{nextRace.laps}</>;
                                            })()}
                                        </div>
                                    </div>
                                </div>

                                {(() => {
                                    // Determine Sprints Display Logic Inline
                                    if (nextRace.eventMode === 'multi' && nextRace.eventConfiguration) {
                                        return (
                                            <div className="border-t border-border pt-4 mb-6">
                                                <h4 className="text-sm font-semibold text-card-foreground mb-3">Pointsprint</h4>
                                                <div className="space-y-4">
                                                    {nextRace.eventConfiguration.map((config, idx) => {
                                                        const catSprints = config.sprints || [];
                                                        if (catSprints.length === 0) return null;

                                                        const sprintsByLap = catSprints.reduce((acc, seg) => {
                                                            const lap = seg.lap || 1;
                                                            if (!acc[lap]) acc[lap] = [];
                                                            acc[lap].push(seg);
                                                            return acc;
                                                        }, {} as Record<number, Segment[]>);

                                                        return (
                                                            <div key={idx} className="text-sm">
                                                                <div className="font-semibold text-xs uppercase text-muted-foreground mb-2 border-b border-border pb-1">
                                                                    {config.customCategory}
                                                                </div>
                                                                <div className="space-y-2">
                                                                    {Object.keys(sprintsByLap).sort((a, b) => parseInt(a) - parseInt(b)).map(lapKey => {
                                                                        const lapNum = parseInt(lapKey);
                                                                        return (
                                                                            <div key={lapNum} className="flex flex-col sm:flex-row gap-2 sm:gap-4 text-xs">
                                                                                <div className="w-12 font-medium text-muted-foreground shrink-0">Omgang {lapNum}</div>
                                                                                <div className="flex-1 flex flex-wrap gap-2">
                                                                                    {sprintsByLap[lapNum].sort((a, b) => a.count - b.count).map((seg, sIdx) => (
                                                                                        <span key={sIdx} className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-secondary text-secondary-foreground border border-border">
                                                                                            {seg.name}
                                                                                        </span>
                                                                                    ))}
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        );
                                    } else if (nextRace.sprints && nextRace.sprints.length > 0) {
                                        // Legacy Single Mode
                                        return (
                                            <div className="border-t border-border pt-4 mb-6">
                                                <h4 className="text-sm font-semibold text-card-foreground mb-3">Pointsprint</h4>
                                                <div className="space-y-3">
                                                    {/* Group by lap for display */}
                                                    {Object.entries(
                                                        nextRace.sprints.reduce((acc, seg) => {
                                                            const lap = seg.lap || 1;
                                                            if (!acc[lap]) acc[lap] = [];
                                                            acc[lap].push(seg);
                                                            return acc;
                                                        }, {} as Record<number, Segment[]>)
                                                    )
                                                        .sort(([a], [b]) => parseInt(a) - parseInt(b))
                                                        .map(([lapKey, segments]) => (
                                                            <div key={lapKey} className="flex flex-col sm:flex-row gap-2 sm:gap-8 text-sm">
                                                                <div className="w-16 font-medium text-muted-foreground shrink-0">Omgang {lapKey}</div>
                                                                <div className="flex-1 flex flex-wrap gap-2">
                                                                    {segments.sort((a, b) => a.count - b.count).map((seg, idx) => (
                                                                        <span key={idx} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                                                                            {seg.name}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        ))}
                                                </div>
                                            </div>
                                        );
                                    }
                                    return null;
                                })()}

                                {nextRace.eventMode === 'multi' ? (
                                    <div className="flex flex-col gap-2">
                                        {nextRace.eventConfiguration?.map((config, i) => (
                                            <a
                                                key={i}
                                                href={`https://www.zwift.com/eu/events/view/${config.eventId}${config.eventSecret ? `?eventSecret=${config.eventSecret}` : ''}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="block w-full bg-primary hover:bg-primary-dark text-white font-bold py-2 px-4 rounded-lg text-center transition shadow-md flex items-center justify-center gap-2 text-sm"
                                            >
                                                <span>Løbspas: {config.customCategory}</span>
                                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                                                    <polyline points="15 3 21 3 21 9"></polyline>
                                                    <line x1="10" y1="14" x2="21" y2="3"></line>
                                                </svg>
                                            </a>
                                        ))}
                                    </div>
                                ) : (
                                    nextRace.eventId && (
                                        <a
                                            href={`https://www.zwift.com/eu/events/view/${nextRace.eventId}${nextRace.eventSecret ? `?eventSecret=${nextRace.eventSecret}` : ''}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="block w-full bg-primary hover:bg-primary-dark text-white font-bold py-3 px-4 rounded-lg text-center transition shadow-md flex items-center justify-center gap-2"
                                        >
                                            <span>Løbspas</span>
                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                                                <polyline points="15 3 21 3 21 9"></polyline>
                                                <line x1="10" y1="14" x2="21" y2="3"></line>
                                            </svg>
                                        </a>
                                    )
                                )}
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <Link href="/participants" className="p-6 border border-border rounded-lg shadow-sm hover:shadow-md transition bg-card text-card-foreground group text-left">
                            <h2 className="text-2xl font-semibold mb-2 group-hover:text-primary">Deltagere &rarr;</h2>
                            <p className="text-muted-foreground">
                                Tjek hvem der stiller til start.
                            </p>
                        </Link>

                        <Link href="/results" className="p-6 border border-border rounded-lg shadow-sm hover:shadow-md transition bg-card text-card-foreground group text-left">
                            <h2 className="text-2xl font-semibold mb-2 group-hover:text-primary">Resultater &rarr;</h2>
                            <p className="text-muted-foreground">
                                Se løbsresultater og ligastillingen.
                            </p>
                        </Link>

                        <Link href="/stats" className="p-6 border border-border rounded-lg shadow-sm hover:shadow-md transition bg-card text-card-foreground group text-left md:col-span-2">
                            <h2 className="text-2xl font-semibold mb-2 group-hover:text-primary">Min Statistik &rarr;</h2>
                            <p className="text-muted-foreground">
                                Sammenlign din præstation med andre ryttere.
                            </p>
                        </Link>
                    </div>
                </div>
            </div>

            {/* Secondary Section - Community for Logged-In Users */}
            <div className="w-full py-24 px-4 bg-[#E7E3D6] text-slate-900 relative z-10 overflow-hidden mt-12">
                {/* Decorative Sand Blob */}
                <div className="absolute top-0 -left-64 md:-left-20 w-[600px] h-[800px] bg-[#F1EFE7] rounded-full pointer-events-none z-0 rotate-12"></div>
                <div className="absolute -bottom-20 right-0 w-[400px] h-[400px] bg-[#F1EFE7] rounded-full pointer-events-none z-0 -rotate-12 translate-x-1/2"></div>

                <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center relative z-20">
                    <div>
                        <h2 className="text-3xl md:text-4xl font-bold mb-6">Bliv en del af fællesskabet</h2>
                        <p className="text-lg text-muted-foreground mb-6">
                            Forbind med andre ryttere på tværs af Danmark, følg de officielle nyheder, og deltag i live løbschat under DCU Member League.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                        <a href="https://www.facebook.com/EcyklingDCU" target="_blank" rel="noopener noreferrer" className="p-6 rounded-2xl border border-border/60 bg-card/50 hover:bg-card hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/10 transition-all group flex flex-col justify-between h-44">
                            <div className="text-blue-500 mb-4 bg-blue-500/10 w-fit p-3 rounded-xl group-hover:scale-110 transition-transform">
                                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" /></svg>
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-foreground group-hover:text-blue-500 transition-colors">Facebook Side</h3>
                                <p className="text-sm text-muted-foreground mt-1">Officielle DCU E-cykling Nyheder</p>
                            </div>
                        </a>

                        <a href="https://discord.gg/kSfHzxmU3u" target="_blank" rel="noopener noreferrer" className="p-6 rounded-2xl border border-border/60 bg-card/50 hover:bg-card hover:border-indigo-500/50 hover:shadow-lg hover:shadow-indigo-500/10 transition-all group flex flex-col justify-between h-44">
                            <div className="text-indigo-500 mb-4 bg-indigo-500/10 w-fit p-3 rounded-xl group-hover:scale-110 transition-transform flex items-center justify-center" style={{ width: 52, height: 52 }}>
                                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
                                </svg>
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-foreground group-hover:text-indigo-500 transition-colors">Discord Server</h3>
                                <p className="text-sm text-muted-foreground mt-1">Live løbschat & support</p>
                            </div>
                        </a>
                    </div>
                </div>
                <CodeOfConductModal isOpen={showCoCModal} onClose={() => setShowCoCModal(false)} />
            </div>

            <ECyclingClubsModal isOpen={showClubsModal} onClose={() => setShowClubsModal(false)} />
            <WelcomeModal />
        </div>
    );
}
