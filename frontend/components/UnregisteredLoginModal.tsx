import React, { useEffect, useState } from 'react';

interface UnregisteredLoginModalProps {
    isOpen: boolean;
    onClose: () => void;
    onStartRegistration: () => void;
}

export default function UnregisteredLoginModal({ isOpen, onClose, onStartRegistration }: UnregisteredLoginModalProps) {
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
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300" onClick={onClose}></div>

            <div className={`relative w-full max-w-md bg-card text-card-foreground rounded-2xl shadow-2xl overflow-hidden transform transition-all duration-300 ${isVisible ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 translate-y-4'}`}>
                <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-red-500 to-orange-500"></div>

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
                    <div className="text-center mb-6">
                        <div className="mx-auto w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mb-4">
                            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500">
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="12" y1="8" x2="12" y2="12"></line>
                                <line x1="12" y1="16" x2="12.01" y2="16"></line>
                            </svg>
                        </div>
                        <h2 className="text-2xl font-bold mb-2">Ikke registreret endnu</h2>
                        <p className="text-muted-foreground text-sm leading-relaxed">
                            Der findes ingen profil for denne Google-konto på DCU Member League. For at logge ind skal du først oprette dig som bruger.
                        </p>
                    </div>

                    <div className="flex flex-col gap-3">
                        <button
                            onClick={onStartRegistration}
                            className="w-full bg-primary text-primary-foreground py-3 px-4 rounded-xl font-bold hover:bg-primary-dark transition-all shadow-md hover:shadow-lg"
                        >
                            Start tilmelding
                        </button>
                        <button
                            onClick={onClose}
                            className="w-full border border-border text-foreground hover:bg-muted py-3 px-4 rounded-xl font-medium transition-all"
                        >
                            Luk
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
