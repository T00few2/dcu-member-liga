'use client';

import { useState } from 'react';
import CodeOfConductModal from '@/components/CodeOfConductModal';
import PolicyModal from '@/components/PolicyModal';

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
    const [showDataPolicyModal, setShowDataPolicyModal] = useState(false);
    const [showPublicResultsModal, setShowPublicResultsModal] = useState(false);

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
                            Jeg accepterer, hvordan persondata behandles som beskrevet i{' '}
                            <button
                                type="button"
                                onClick={() => setShowDataPolicyModal(true)}
                                className="text-primary hover:underline font-medium"
                            >
                                Datapolitikken
                            </button>.
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
                            Jeg giver samtykke til, at mit navn og resultater offentliggøres på denne hjemmeside og DCU-platforme som beskrevet i{' '}
                            <button
                                type="button"
                                onClick={() => setShowPublicResultsModal(true)}
                                className="text-primary hover:underline font-medium"
                            >
                                bekendtgørelsen for offentliggørelse
                            </button>.
                        </p>
                    </div>
                </div>
            </div>

            {/* CoC Modal */}
            <CodeOfConductModal
                isOpen={showCoCModal}
                onClose={() => setShowCoCModal(false)}
                onAccept={() => {
                    if (!readOnly) setAcceptedCoC(true);
                    setShowCoCModal(false);
                }}
                disableAccept={readOnly}
            />

            {/* Data Policy Modal */}
            <PolicyModal
                isOpen={showDataPolicyModal}
                onClose={() => setShowDataPolicyModal(false)}
                policyEndpoint="dataPolicy"
                onAccept={() => {
                    if (!readOnly) setAcceptedDataPolicy(true);
                    setShowDataPolicyModal(false);
                }}
                disableAccept={readOnly}
            />

            {/* Public Results Modal */}
            <PolicyModal
                isOpen={showPublicResultsModal}
                onClose={() => setShowPublicResultsModal(false)}
                policyEndpoint="publicResultsConsent"
                onAccept={() => {
                    if (!readOnly) setAcceptedPublicResults(true);
                    setShowPublicResultsModal(false);
                }}
                disableAccept={readOnly}
            />
        </div>
    );
}
