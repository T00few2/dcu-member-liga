import Link from 'next/link';

export const metadata = {
    title: 'Om E-cykling og ligaen',
    description: 'Information om e-cykling, udstyr og hvordan du deltager i DCU forårsliga på Zwift.',
    openGraph: {
        title: 'DCU forårsliga – Om E-cykling',
        description: 'Information om e-cykling, udstyr og hvordan du deltager i DCU forårsliga på Zwift.',
        url: '/info',
    },
};

export default function InfoPage() {
    return (
        <div className="w-full relative -mt-4 text-foreground bg-background">
            {/* Animated Hero Section with Video */}
            <div className="relative w-full min-h-[50vh] flex flex-col items-center justify-center overflow-hidden bg-black pb-16 pt-8">
                <video autoPlay loop muted playsInline preload="auto" className="absolute inset-0 w-full h-full object-cover z-0 opacity-40 mix-blend-screen bg-black">
                    <source src="/hero-video.mp4" type="video/mp4" />
                </video>
                <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/50 to-background/95 z-0"></div>
                <div className="absolute top-1/4 left-1/4 w-[30rem] h-[30rem] bg-primary/20 rounded-full mix-blend-screen filter blur-[120px] animate-pulse z-0"></div>
                <div className="absolute bottom-1/4 right-1/4 w-[30rem] h-[30rem] bg-white/10 rounded-full mix-blend-screen filter blur-[120px] animate-pulse [animation-delay:2s] z-0"></div>

                <div className="relative z-10 flex flex-col items-center text-center px-4 mt-8 max-w-5xl mx-auto">
                    <h1 className="text-5xl md:text-6xl font-extrabold mb-4 tracking-tight text-white drop-shadow-lg pb-2 animate-in fade-in zoom-in-95 duration-1000">
                        Om <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-white">E-cykling</span>
                    </h1>
                    <p className="text-xl mb-8 max-w-2xl text-slate-300 font-light drop-shadow animate-in fade-in slide-in-from-bottom-4 duration-1000 delay-150">
                        E-cykling er en af de hurtigst voksende cykeldiscipliner. Her kan du træne og køre løb mod andre ryttere hjemme fra din stue.
                    </p>
                </div>
            </div>

            {/* Content */}
            <div className="container mx-auto px-4 -mt-12 relative z-20 pb-20 animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-300 max-w-4xl">
                <div className="bg-card dark:bg-slate-800 rounded-2xl shadow-xl shadow-slate-200/40 dark:shadow-none border border-border dark:border-slate-700 p-8 md:p-12 space-y-12">

                    <section>
                        <div className="flex items-center gap-3 mb-4 border-b border-slate-100 dark:border-slate-700 pb-3">
                            <div className="p-2 bg-primary/10 rounded-lg text-primary">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                            </div>
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                                Hvad er E-cykling?
                            </h2>
                        </div>
                        <p className="text-slate-600 dark:text-slate-300 leading-relaxed text-lg">
                            E-cykling (elektronisk cykling) kombinerer den fysiske anstrengelse fra traditionel cykling med en virtuel oplevelse.
                            Ved hjælp af en hometrainer koblet til en skærm, overføres dine tråd i pedalerne til en avatar i et digitalt univers.
                            Det giver dig mulighed for at cykle på virtuelle ruter, træne med venner eller konkurrere i løb mod ryttere fra hele verden – uanset vind og vejr udenfor.
                        </p>
                    </section>

                    <section>
                        <div className="flex items-center gap-3 mb-4 border-b border-slate-100 dark:border-slate-700 pb-3">
                            <div className="p-2 bg-blue-500/10 rounded-lg text-blue-600 dark:text-blue-400">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                            </div>
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                                Hvad kræver det?
                            </h2>
                        </div>
                        <p className="text-slate-600 dark:text-slate-300 leading-relaxed mb-6 text-lg">
                            For at komme i gang med e-cykling og deltage i løb, skal du bruge følgende udstyr:
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {[
                                'En cykel (racer, mountainbike eller gravel - så længe den passer på hometraineren)',
                                'En smart "hometrainer" (direct drive anbefales til konkurrence), der kan justere modstanden automatisk.',
                                'En enhed til at køre softwaren (PC, Mac, Apple TV, iPad eller nyere smartphone).',
                                'En platformskonto (f.eks. Zwift, hvor Ligaen afvikles).',
                                'En pulsmåler (brystrem eller armbånd), som er påkrævet i de fleste løb.'
                            ].map((item, i) => (
                                <div key={i} className="flex items-start gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800">
                                    <div className="mt-1 flex-shrink-0 text-primary">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                                    </div>
                                    <span className="text-slate-700 dark:text-slate-300">{item}</span>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section>
                        <div className="flex items-center gap-3 mb-4 border-b border-slate-100 dark:border-slate-700 pb-3">
                            <div className="p-2 bg-green-500/10 rounded-lg text-green-600 dark:text-green-400">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            </div>
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                                Deltagelse i DCU forårsliga
                            </h2>
                        </div>
                        <p className="text-slate-600 dark:text-slate-300 leading-relaxed mb-6 text-lg">
                            Som medlem kan du deltage i ligaens løb. For at sikre fair play og god konkurrence er der visse retningslinjer:
                        </p>
                        <div className="space-y-4">
                            <div className="pl-4 border-l-4 border-primary">
                                <h4 className="font-bold text-slate-900 dark:text-white mb-1">Registrering af højde og vægt</h4>
                                <p className="text-slate-600 dark:text-slate-400">Deltagere skal være registreret med korrekt højde og vægt på deres profil samt i Zwift, for at Watt/kg udregnes korrekt i spillet.</p>
                            </div>
                            <div className="pl-4 border-l-4 border-tertiary">
                                <h4 className="font-bold text-slate-900 dark:text-white mb-1">Stikprøvekontrol (Weight Verification)</h4>
                                <p className="text-slate-600 dark:text-slate-400">For at sikre integritet vil der fra tid til anden blive krævet videodokumentation af din aktuelle vægt.</p>
                            </div>
                            <div className="pl-4 border-l-4 border-blue-500">
                                <h4 className="font-bold text-slate-900 dark:text-white mb-1">Tilslutning af Profil</h4>
                                <p className="text-slate-600 dark:text-slate-400">Husk at forbinde din Zwift ID og andre nødvendige detaljer i dine brugerindstillinger her på siden, før du tilmelder dig et løb.</p>
                            </div>
                        </div>
                    </section>

                </div>

                <div className="mt-12 text-center">
                    <Link href="/" className="inline-flex items-center gap-2 justify-center px-8 py-4 text-base font-bold rounded-xl text-slate-700 bg-white hover:bg-slate-50 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700 shadow-sm border border-slate-200 dark:border-slate-700 transition-all hover:scale-[1.02]">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
                        </svg>
                        Tilbage til forsiden
                    </Link>
                </div>
            </div>
        </div>
    );
}
