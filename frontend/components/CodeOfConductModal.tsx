import React from 'react';

interface CodeOfConductModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAccept?: () => void;
    disableAccept?: boolean;
}

export default function CodeOfConductModal({ isOpen, onClose, onAccept, disableAccept }: CodeOfConductModalProps) {
    if (!isOpen) return null;

    const docUrl = "https://docs.google.com/document/d/1lQE0w8ylJLoBscj6rgWZ4nGYqKbCsoin9HR4wBiF3V4/preview";

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            {/* Backdrop click to close */}
            <div className="absolute inset-0" onClick={onClose}></div>

            <div className="bg-card w-full max-w-4xl max-h-[90vh] rounded-xl shadow-2xl flex flex-col border border-border relative z-10 animate-in fade-in zoom-in-95 duration-200">
                <div className="p-4 sm:p-6 border-b border-border/50 bg-muted/30 flex justify-between items-center">
                    <h2 className="text-xl sm:text-2xl font-bold text-foreground truncate mr-4">DCU E-Cycling Code of Conduct</h2>
                    <button
                        onClick={onClose}
                        className="p-2 -mr-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-full transition-colors shrink-0"
                        aria-label="Luk"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                    </button>
                </div>

                {/* Google Docs embed container */}
                <div className="w-full h-[60vh] sm:h-[70vh] bg-white relative">
                    <iframe
                        src={docUrl}
                        className="w-full h-full border-0 absolute inset-0"
                        title="DCU E-Cycling Code of Conduct"
                        allowFullScreen
                    />
                </div>

                <div className="p-4 border-t border-border/50 flex flex-col sm:flex-row justify-between items-center gap-3 bg-muted/30">
                    <a
                        href="https://docs.google.com/document/d/1lQE0w8ylJLoBscj6rgWZ4nGYqKbCsoin9HR4wBiF3V4/edit?tab=t.0#heading=h.epmyt5apdaf3"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-semibold text-primary hover:underline flex items-center gap-1.5"
                    >
                        Åbn i Google Docs <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>
                    </a>

                    <div className="flex gap-3 w-full sm:w-auto mt-2 sm:mt-0">
                        <button
                            onClick={onClose}
                            className={`flex-1 sm:flex-none px-6 py-2.5 font-bold rounded-xl transition-colors ${onAccept ? 'text-muted-foreground hover:text-foreground hover:bg-muted' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`}
                        >
                            {onAccept ? 'Luk' : 'Ok, luk'}
                        </button>

                        {onAccept && (
                            <button
                                onClick={() => {
                                    if (!disableAccept) onAccept();
                                }}
                                disabled={disableAccept}
                                className="flex-1 sm:flex-none px-8 py-2.5 bg-primary text-primary-foreground font-bold rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Jeg accepterer
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
