'use client';

import { useState } from 'react';
import Link from 'next/link';

interface AgreementsFormProps {
    acceptedCoC: boolean;
    setAcceptedCoC: (val: boolean) => void;
    acceptedDataPolicy: boolean;
    setAcceptedDataPolicy: (val: boolean) => void;
    acceptedPublicResults: boolean;
    setAcceptedPublicResults: (val: boolean) => void;
    readOnly?: boolean;
}

export default function AgreementsForm({
    acceptedCoC, setAcceptedCoC,
    acceptedDataPolicy, setAcceptedDataPolicy,
    acceptedPublicResults, setAcceptedPublicResults,
    readOnly = false
}: AgreementsFormProps) {
    const [showCoCModal, setShowCoCModal] = useState(false);

    return (
        <div className="space-y-6">

            {/* 1. Code of Conduct */}
            <div className={`p-4 border rounded-lg transition-colors ${acceptedCoC ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800' : 'bg-card border-border'}`}>
                <div className="flex gap-3">
                    <div className="pt-0.5">
                        <input
                            type="checkbox"
                            checked={acceptedCoC}
                            onChange={(e) => !readOnly && setAcceptedCoC(e.target.checked)}
                            disabled={readOnly || /* Force view modal logic? For now simple */ false}
                            id="coc-check"
                            className="w-5 h-5 rounded border-gray-300 text-primary focus:ring-primary"
                        />
                    </div>
                    <div>
                        <label htmlFor="coc-check" className="font-semibold text-card-foreground cursor-pointer">
                            Code of Conduct
                        </label>
                        <p className="text-sm text-muted-foreground mt-1">
                            Jeg accepterer at følge DCU E-cykling Etisk Kodeks.
                        </p>
                        <button
                            type="button"
                            onClick={() => setShowCoCModal(true)}
                            className="text-xs text-primary hover:underline mt-2 font-medium"
                        >
                            Læs Etisk Kodeks
                        </button>
                    </div>
                </div>
            </div>

            {/* 2. Data Policy */}
            <div className={`p-4 border rounded-lg transition-colors ${acceptedDataPolicy ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800' : 'bg-card border-border'}`}>
                <div className="flex gap-3">
                    <div className="pt-0.5">
                        <input
                            type="checkbox"
                            checked={acceptedDataPolicy}
                            onChange={(e) => !readOnly && setAcceptedDataPolicy(e.target.checked)}
                            disabled={readOnly}
                            id="data-check"
                            className="w-5 h-5 rounded border-gray-300 text-primary focus:ring-primary"
                        />
                    </div>
                    <div>
                        <label htmlFor="data-check" className="font-semibold text-card-foreground cursor-pointer">
                            Accepter venligst Datapolitikken
                        </label>
                        <p className="text-sm text-muted-foreground mt-1">
                            Jeg accepterer, hvordan persondata behandles som beskrevet i <Link href="/datapolitik" target="_blank" className="text-primary hover:underline">Datapolitikken</Link>.
                        </p>
                    </div>
                </div>
            </div>

            {/* 3. Public Results */}
            <div className={`p-4 border rounded-lg transition-colors ${acceptedPublicResults ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800' : 'bg-card border-border'}`}>
                <div className="flex gap-3">
                    <div className="pt-0.5">
                        <input
                            type="checkbox"
                            checked={acceptedPublicResults}
                            onChange={(e) => !readOnly && setAcceptedPublicResults(e.target.checked)}
                            disabled={readOnly}
                            id="public-check"
                            className="w-5 h-5 rounded border-gray-300 text-primary focus:ring-primary"
                        />
                    </div>
                    <div>
                        <label htmlFor="public-check" className="font-semibold text-card-foreground cursor-pointer">
                            Offentliggørelse af resultater
                        </label>
                        <p className="text-sm text-muted-foreground mt-1">
                            Jeg giver samtykke til, at mit navn og resultater offentliggøres på denne hjemmeside og DCU-platforme som beskrevet i <Link href="/offentliggoerelse" target="_blank" className="text-primary hover:underline">bekendtgørelsen for offentliggørelse</Link>.
                        </p>
                    </div>
                </div>
            </div>

            {/* CoC Modal */}
            {showCoCModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-card w-full max-w-2xl max-h-[80vh] rounded-lg shadow-xl flex flex-col border border-border">
                        <div className="p-6 border-b border-border">
                            <h2 className="text-2xl font-bold text-card-foreground">DCU E-Cycling Code of Conduct</h2>
                        </div>
                        <div className="p-6 overflow-y-auto prose dark:prose-invert max-w-none">
                            <p>Her finder du reglerne for fair play, respekt og god sportsånd.</p>
                            <ul>
                                <li>Vær respektfuld overfor andre ryttere og arrangører.</li>
                                <li>Snyd eller manipulation af udstyr/data er ikke tilladt.</li>
                                <li>Brug korrekte mål for vægt og højde.</li>
                                <li>Følg instruktioner fra løbets ledelse.</li>
                            </ul>
                            <p>Manglende overholdelse kan resultere i diskvalifikation eller karantæne.</p>
                        </div>
                        <div className="p-6 border-t border-border flex justify-end gap-3">
                            <button
                                onClick={() => setShowCoCModal(false)}
                                className="px-5 py-2 text-muted-foreground hover:text-foreground font-medium"
                            >
                                Luk
                            </button>
                            <button
                                onClick={() => {
                                    if (!readOnly) setAcceptedCoC(true);
                                    setShowCoCModal(false);
                                }}
                                disabled={readOnly}
                                className="px-5 py-2 bg-primary text-primary-foreground font-bold rounded hover:bg-primary-dark transition-colors"
                            >
                                Jeg accepterer
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
