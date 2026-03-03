import React from 'react';

interface CodeOfConductModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function CodeOfConductModal({ isOpen, onClose }: CodeOfConductModalProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            {/* Backdrop click to close */}
            <div className="absolute inset-0" onClick={onClose}></div>

            <div className="bg-card w-full max-w-2xl max-h-[80vh] rounded-xl shadow-2xl flex flex-col border border-border relative z-10 animate-in fade-in zoom-in-95 duration-200">
                <div className="p-6 border-b border-border/50 bg-muted/30 flex justify-between items-center">
                    <h2 className="text-2xl font-bold text-foreground">DCU E-Cycling Code of Conduct</h2>
                    <button
                        onClick={onClose}
                        className="p-2 -mr-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-full transition-colors"
                        aria-label="Luk"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                    </button>
                </div>

                <div className="p-6 overflow-y-auto prose dark:prose-invert max-w-none custom-scrollbar">
                    <p className="text-muted-foreground text-lg mb-4">Her finder du reglerne for fair play, respekt og god sportsånd i DCU Member Ligaen.</p>

                    <div className="bg-background border border-border/60 rounded-xl p-6 space-y-4">
                        <div className="flex gap-4">
                            <div className="text-primary mt-1">
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                            </div>
                            <div>
                                <h4 className="font-bold text-foreground text-lg m-0">Respekt for fællesskabet</h4>
                                <p className="text-muted-foreground m-0 mt-1">Vær altid respektfuld overfor andre ryttere og arrangører. Upassende sprogbrug eller chikane tolereres ikke.</p>
                            </div>
                        </div>

                        <div className="flex gap-4">
                            <div className="text-primary mt-1">
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><line x1="9" x2="15" y1="12" y2="12" /></svg>
                            </div>
                            <div>
                                <h4 className="font-bold text-foreground text-lg m-0">Nul tolerance for snyd</h4>
                                <p className="text-muted-foreground m-0 mt-1">Snyd eller bevidst manipulation af udstyr, data, eller in-game mekanikker er strengt forbudt.</p>
                            </div>
                        </div>

                        <div className="flex gap-4">
                            <div className="text-primary mt-1">
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20.42 4.58a5.4 5.4 0 0 0-7.65 0l-.77.78-.77-.78a5.4 5.4 0 0 0-7.65 0C1.46 6.7 1.33 10.28 4 13l8 8 8-8c2.67-2.72 2.54-6.3.42-8.42z" /></svg>
                            </div>
                            <div>
                                <h4 className="font-bold text-foreground text-lg m-0">Fysiske specifikationer</h4>
                                <p className="text-muted-foreground m-0 mt-1">Du skal altid bruge valide og korrekte mål for din kropsvægt og højde, opdateret regelmæssigt.</p>
                            </div>
                        </div>

                        <div className="flex gap-4">
                            <div className="text-primary mt-1">
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" x2="12" y1="8" y2="12" /><line x1="12" x2="12.01" y1="16" y2="16" /></svg>
                            </div>
                            <div>
                                <h4 className="font-bold text-foreground text-lg m-0">Retningslinjer</h4>
                                <p className="text-muted-foreground m-0 mt-1">Følg altid anvisninger og instruktioner givet fra løbets ledelse og DCU's official-team.</p>
                            </div>
                        </div>
                    </div>

                    <p className="text-sm text-muted-foreground mt-4 italic">
                        Manglende overholdelse af disse regler kan resultere i tidsstraf, diskvalifikation fra løb eller permanent karantæne fra ligaen.
                    </p>
                </div>

                <div className="p-4 border-t border-border/50 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-6 py-2.5 bg-secondary text-secondary-foreground font-bold rounded-xl hover:bg-secondary/80 transition-colors"
                    >
                        Ok, luk
                    </button>
                </div>
            </div>
        </div>
    );
}
