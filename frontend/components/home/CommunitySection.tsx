'use client';

interface CommunitySectionProps {
    loggedIn?: boolean;
    onShowCoCModal?: () => void;
}

export default function CommunitySection({ loggedIn = false, onShowCoCModal }: CommunitySectionProps) {
    return (
        <div className="w-full py-24 px-4 bg-[#E7E3D6] text-slate-900 relative z-10 overflow-hidden mt-12">
            <div className="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/4 w-[600px] h-[600px] sm:w-[800px] sm:h-[800px] bg-[#F1EFE7] rounded-full pointer-events-none z-0"></div>
            <div className="absolute bottom-0 right-0 translate-x-1/3 translate-y-1/4 w-[400px] h-[400px] sm:w-[600px] sm:h-[600px] bg-[#F1EFE7] rounded-full pointer-events-none z-0"></div>

            <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center relative z-20">
                <div>
                    <h2 className="text-3xl md:text-4xl font-bold mb-6">
                        {loggedIn ? 'Bliv en del af fællesskabet' : 'Bliv en del af E-cykling fællesskabet'}
                    </h2>
                    {loggedIn ? (
                        <p className="text-lg text-muted-foreground mb-6">
                            Forbind med andre ryttere på tværs af Danmark, følg de officielle nyheder, og deltag i live løbschat under DCU forårsliga.
                        </p>
                    ) : (
                        <>
                            <p className="text-lg text-muted-foreground mb-6">
                                Oplev spændingen ved kompetitivt cykelløb fra din stue. DCU forårsligaen forbinder ryttere på tværs af Danmark i organiserede, strukturerede og fair virtuelle løb på Zwift.
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
                        </>
                    )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <a
                        href={loggedIn ? 'https://www.facebook.com/EcyklingDCU' : 'https://www.facebook.com/groups/edcudk'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-6 rounded-2xl border border-border/60 bg-card/50 hover:bg-card hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/10 transition-all group flex flex-col justify-between h-44"
                    >
                        <div className="text-blue-500 mb-4 bg-blue-500/10 w-fit p-3 rounded-xl group-hover:scale-110 transition-transform">
                            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" /></svg>
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-foreground group-hover:text-blue-500 transition-colors">
                                {loggedIn ? 'Facebook Side' : 'Facebook Gruppe'}
                            </h3>
                            <p className="text-sm text-muted-foreground mt-1">
                                {loggedIn ? 'Officielle DCU E-cykling Nyheder' : 'Deltag i debatten'}
                            </p>
                        </div>
                    </a>

                    <a
                        href="https://discord.gg/kSfHzxmU3u"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-6 rounded-2xl border border-border/60 bg-card/50 hover:bg-card hover:border-indigo-500/50 hover:shadow-lg hover:shadow-indigo-500/10 transition-all group flex flex-col justify-between h-44"
                    >
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

                    <a
                        href="https://youtube.com/@danishecycling"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-6 rounded-2xl border border-border/60 bg-card/50 hover:bg-card hover:border-red-500/50 hover:shadow-lg hover:shadow-red-500/10 transition-all group flex flex-col justify-between h-44"
                    >
                        <div className="text-red-500 mb-4 bg-red-500/10 w-fit p-3 rounded-xl group-hover:scale-110 transition-transform">
                            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                            </svg>
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-foreground group-hover:text-red-500 transition-colors">YouTube</h3>
                            <p className="text-sm text-muted-foreground mt-1">Live broadcast af elite løb</p>
                        </div>
                    </a>

                    <a
                        href="https://twitch.tv/dcu_live_tv"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-6 rounded-2xl border border-border/60 bg-card/50 hover:bg-card hover:border-purple-500/50 hover:shadow-lg hover:shadow-purple-500/10 transition-all group flex flex-col justify-between h-44"
                    >
                        <div className="text-purple-500 mb-4 bg-purple-500/10 w-fit p-3 rounded-xl group-hover:scale-110 transition-transform">
                            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
                            </svg>
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-foreground group-hover:text-purple-500 transition-colors">Twitch</h3>
                            <p className="text-sm text-muted-foreground mt-1">Live broadcast af elite løb</p>
                        </div>
                    </a>

                    {!loggedIn && onShowCoCModal && (
                        <button
                            onClick={onShowCoCModal}
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
                    )}
                </div>
            </div>
        </div>
    );
}
