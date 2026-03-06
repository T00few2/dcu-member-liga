'use client';

import { Suspense } from 'react';
import { useRegistration } from '@/hooks/useRegistration';
import RiderInfoForm from '@/components/register/RiderInfoForm';
import ConnectionsForm from '@/components/register/ConnectionsForm';
import AgreementsForm from '@/components/register/AgreementsForm';
import VerificationStatus from '@/components/register/VerificationStatus';

function RegisterContent() {
    const {
        authLoading, fetchingProfile,
        eLicense, setELicense, name, setName, zwiftId, setZwiftId,
        club, setClub, trainer, setTrainer, stravaConnected,
        acceptedCoC, setAcceptedCoC, acceptedDataPolicy, setAcceptedDataPolicy,
        acceptedPublicResults, setAcceptedPublicResults,
        weightVerificationStatus, weightVerificationVideoLink,
        weightVerificationDeadline, verificationRequests, refreshProfile,
        clubs, loadingClubs, clubsError,
        trainers, loadingTrainers, trainersError,
        zwiftVerified, verifyingZwift, zwiftName, zwiftError,
        checkingLicense, licenseAvailable, licenseCheckMessage,
        isRegistered, activeTab, setActiveTab, currentStep, setCurrentStep,
        submitting, savingProgress, message, error,
        step0Valid, step1Valid, step2Valid,
        checkLicense, verifyZwiftId, confirmZwiftIdentity,
        handleConnectStrava, handleDisconnectStrava, handleRequestTrainer, saveData,
    } = useRegistration();

    if (authLoading || fetchingProfile) {
        return <div className="p-8 text-center text-muted-foreground">Indlæser profil...</div>;
    }

    const riderInfoProps = {
        name, setName, eLicense, setELicense, club, setClub, trainer, setTrainer,
        clubs, loadingClubs, clubsError,
        trainers, loadingTrainers, trainersError,
        licenseAvailable, checkingLicense, checkLicense, licenseCheckMessage,
        onRequestTrainer: handleRequestTrainer,
        zwiftId, setZwiftId, zwiftVerified, verifyingZwift,
        zwiftName, zwiftError, verifyZwiftId, confirmZwiftIdentity,
    };

    const TabButton = ({ id, label, active, warning = false }: { id: string; label: string; active: boolean; warning?: boolean }) => (
        <button
            onClick={() => setActiveTab(id)}
            className={`flex-1 pb-3 text-sm font-medium border-b-2 transition-colors ${
                active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            } ${warning ? 'text-orange-600 dark:text-orange-400' : ''}`}
        >
            {label} {warning && '⚠️'}
        </button>
    );

    return (
        <div className="max-w-2xl mx-auto mt-10 p-8 bg-card rounded-lg shadow-md border border-border">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold text-card-foreground">
                    {isRegistered ? 'Rytterprofil' : 'Tilmelding'}
                </h1>
                {!isRegistered && (
                    <button
                        onClick={() => saveData(true)}
                        disabled={savingProgress}
                        className="text-sm text-muted-foreground hover:text-primary underline"
                    >
                        {savingProgress ? 'Gemmer...' : 'Gem kladde'}
                    </button>
                )}
            </div>

            {message && <div className="bg-green-50 text-green-700 p-4 rounded mb-6 border border-green-200">{message}</div>}
            {error && <div className="bg-red-50 text-red-700 p-4 rounded mb-6 border border-red-200">{error}</div>}

            {/* TABBED INTERFACE (Registered Users) */}
            {isRegistered && (
                <>
                    <div className="flex gap-2 mb-6 border-b border-border">
                        <TabButton id="info" label="Rytterinfo" active={activeTab === 'info'} />
                        <TabButton id="connections" label="Forbindelser" active={activeTab === 'connections'} />
                        <TabButton id="agreements" label="Aftaler" active={activeTab === 'agreements'} />
                        <TabButton
                            id="verification"
                            label="Bekræftelse"
                            active={activeTab === 'verification'}
                            warning={weightVerificationStatus === 'pending'}
                        />
                    </div>
                    <div className="min-h-[300px]">
                        {activeTab === 'info' && <RiderInfoForm {...riderInfoProps} />}
                        {activeTab === 'connections' && (
                            <ConnectionsForm
                                stravaConnected={stravaConnected}
                                handleConnectStrava={handleConnectStrava}
                                handleDisconnectStrava={handleDisconnectStrava}
                            />
                        )}
                        {activeTab === 'agreements' && (
                            <AgreementsForm
                                acceptedCoC={acceptedCoC} setAcceptedCoC={setAcceptedCoC}
                                acceptedDataPolicy={acceptedDataPolicy} setAcceptedDataPolicy={setAcceptedDataPolicy}
                                acceptedPublicResults={acceptedPublicResults} setAcceptedPublicResults={setAcceptedPublicResults}
                            />
                        )}
                        {activeTab === 'verification' && (
                            <VerificationStatus
                                status={weightVerificationStatus}
                                videoLink={weightVerificationVideoLink}
                                deadline={weightVerificationDeadline}
                                requests={verificationRequests}
                                refreshProfile={refreshProfile}
                            />
                        )}
                    </div>
                </>
            )}

            {/* STEPPER INTERFACE (New Users) */}
            {!isRegistered && (
                <>
                    <div className="flex items-center justify-between mb-8 relative">
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1 bg-secondary rounded-full -z-10" />
                        {[0, 1, 2].map(step => (
                            <div
                                key={step}
                                className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm bg-background border-2 ${
                                    currentStep >= step ? 'border-primary text-primary' : 'border-muted text-muted-foreground'
                                }`}
                            >
                                {step + 1}
                            </div>
                        ))}
                    </div>
                    <div className="min-h-[300px]">
                        {currentStep === 0 && (
                            <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                                <h2 className="text-xl font-semibold mb-4 text-card-foreground">Rytterinformation</h2>
                                <RiderInfoForm {...riderInfoProps} />
                            </div>
                        )}
                        {currentStep === 1 && (
                            <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                                <h2 className="text-xl font-semibold mb-4 text-card-foreground">Forbind konti</h2>
                                <ConnectionsForm
                                    stravaConnected={stravaConnected}
                                    handleConnectStrava={handleConnectStrava}
                                    handleDisconnectStrava={handleDisconnectStrava}
                                />
                            </div>
                        )}
                        {currentStep === 2 && (
                            <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                                <h2 className="text-xl font-semibold mb-4 text-card-foreground">Aftaler</h2>
                                <AgreementsForm
                                    acceptedCoC={acceptedCoC} setAcceptedCoC={setAcceptedCoC}
                                    acceptedDataPolicy={acceptedDataPolicy} setAcceptedDataPolicy={setAcceptedDataPolicy}
                                    acceptedPublicResults={acceptedPublicResults} setAcceptedPublicResults={setAcceptedPublicResults}
                                />
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* Footer Buttons */}
            <div className="mt-8 pt-6 border-t border-border flex justify-end gap-3">
                {isRegistered ? (
                    <button
                        onClick={() => saveData(false)}
                        disabled={submitting}
                        className="px-6 py-2 bg-primary text-primary-foreground font-bold rounded-lg hover:bg-primary-dark disabled:opacity-50"
                    >
                        {submitting ? 'Gemmer...' : 'Gem ændringer'}
                    </button>
                ) : (
                    <>
                        {currentStep > 0 && (
                            <button
                                onClick={() => setCurrentStep(prev => prev - 1)}
                                className="px-6 py-2 border border-border rounded-lg hover:bg-secondary transition-colors"
                            >
                                Tilbage
                            </button>
                        )}
                        {currentStep < 2 ? (
                            <button
                                onClick={() => setCurrentStep(prev => prev + 1)}
                                disabled={currentStep === 0 ? !step0Valid : !step1Valid}
                                className="px-6 py-2 bg-primary text-primary-foreground font-bold rounded-lg hover:bg-primary-dark disabled:opacity-50"
                            >
                                Næste
                            </button>
                        ) : (
                            <button
                                onClick={() => saveData(false)}
                                disabled={submitting || !step2Valid}
                                className="px-8 py-2 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 disabled:opacity-50"
                            >
                                {submitting ? 'Tilmelder...' : 'Gennemfør tilmelding'}
                            </button>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

export default function RegisterPage() {
    return (
        <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Indlæser...</div>}>
            <RegisterContent />
        </Suspense>
    );
}
