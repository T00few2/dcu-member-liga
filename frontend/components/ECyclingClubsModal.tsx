'use client';

import { useEffect, useState } from 'react';

interface ECyclingClubsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function ECyclingClubsModal({ isOpen, onClose }: ECyclingClubsModalProps) {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }

        return () => {
            document.body.style.overflow = 'unset';
            setMounted(false);
        };
    }, [isOpen]);

    if (!mounted || !isOpen) return null;

    const clubs = [
        {
            name: "Copenhagen Virtual Cycling Club (CVC)",
            url: "https://virtualcycling.dk/",
            description: "E-cykel klub i København med egne træningslokaler og instruktører for både motion og konkurrence."
        },
        {
            name: "Danish Zwift Racers (DZR)",
            url: "https://www.dzrracingseries.com/join",
            description: "Landsdækkende dedikeret e-cykel klub med fokus på løb og træning på Zwift."
        },
        {
            name: "Den Blå Mur",
            url: "https://www.facebook.com/denblaamur/?locale=da_DK",
            description: "Et dedikeret e-cykling fællesskab for kvinder, der fokuserer på inklusion og stærkt sammenhold gennem ugentlige sociale Zwift-rides med plads til alle niveauer."
        },
        {
            name: "eCykle Klub Danmark (eCKD)",
            url: "https://ecykleklub.dk/",
            description: "Et landsdækkende fællesskab omkring e-cykling på tværs af niveauer og platforme."
        },
        {
            name: "Stjær E-Cycling",
            url: "https://www.xn--klvermotionscykellb-w7bq.dk/teams-stjaeligr-e-cycling.html",
            description: "En stærk e-cykling afdeling med fokus på holdløb, socialt sammenhold og udvikling på den virtuelle landevej."
        }
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
                onClick={onClose}
            ></div>

            {/* Modal Content */}
            <div className="bg-card w-full max-w-2xl rounded-2xl shadow-2xl relative z-10 overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-border/50 flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-border/50 bg-muted/30">
                    <h2 className="text-2xl font-bold text-foreground">Find en DCU-Klub</h2>
                    <button
                        onClick={onClose}
                        className="p-2 -mr-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-full transition-colors"
                        aria-label="Luk"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                    </button>
                </div>

                {/* Content - Scrollable */}
                <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">

                    {/* Dedicated E-cycling clubs */}
                    <div className="mb-8">
                        <h3 className="text-xl font-bold text-foreground mb-2">Dedikerede E-cykling klubber</h3>
                        <p className="text-muted-foreground mb-6">
                            Hvis du primært kører løb indendørs på platforme som Zwift, er disse klubber skabt til dig. De fokuserer fuldt ud på digital cykling og tilbyder et stærkt online fællesskab.
                        </p>

                        <div className="grid gap-4">
                            {clubs.map((club, index) => (
                                <div key={index} className="bg-background border border-border/60 rounded-xl p-5 hover:border-primary/40 hover:shadow-md transition-all group flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
                                    <div className="flex-1">
                                        <h4 className="text-lg font-bold text-foreground mb-2 group-hover:text-primary transition-colors">
                                            {club.name}
                                        </h4>
                                        <p className="text-sm text-muted-foreground line-clamp-3 sm:line-clamp-2">
                                            {club.description}
                                        </p>
                                    </div>
                                    <a
                                        href={club.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground font-semibold px-4 py-2 rounded-lg text-sm transition-colors flex items-center justify-center gap-2 whitespace-nowrap w-full sm:w-auto mt-2 sm:mt-0"
                                    >
                                        Besøg website <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>
                                    </a>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* All Physical Clubs */}
                    <div className="pt-6 border-t border-border/50">
                        <h3 className="text-xl font-bold text-foreground mb-2">Fysiske DCU Klubber</h3>
                        <p className="text-muted-foreground mb-4">
                            Du kan også vælge at repræsentere en af de mange fysiske cykelklubber på tværs af Danmark, som tilbyder landevejs-, MTB-, eller banecykling ved siden af E-cykling aktiviteten.
                        </p>
                        <a
                            href="https://www.cyklingdanmark.dk/klubber-teams"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="bg-secondary text-secondary-foreground hover:bg-secondary/80 font-bold px-5 py-3 rounded-xl transition-colors flex items-center justify-center gap-2 w-full sm:w-auto"
                        >
                            Se alle DCU-klubber i Danmark <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
                        </a>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-border/50 bg-muted/30 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-6 py-2.5 bg-secondary text-secondary-foreground font-bold rounded-lg hover:bg-secondary-dark transition-colors"
                    >
                        Ok, luk
                    </button>
                </div>
            </div>
        </div>
    );
}
