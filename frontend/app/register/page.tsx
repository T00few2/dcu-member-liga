'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/components/ToastProvider';
import RiderInfoForm from '@/components/register/RiderInfoForm';
import ConnectionsForm from '@/components/register/ConnectionsForm';
import AgreementsForm from '@/components/register/AgreementsForm';
import VerificationStatus from '@/components/register/VerificationStatus';

function RegisterContent() {
    const { user, loading: authLoading, refreshProfile } = useAuth();
    const { showToast } = useToast();
    const router = useRouter();
    const searchParams = useSearchParams();
    const stravaStatusParam = searchParams.get('strava');

    // --- State ---
    // User Data
    const [eLicense, setELicense] = useState('');
    const [name, setName] = useState('');
    const [zwiftId, setZwiftId] = useState('');
    const [club, setClub] = useState('');
    const [trainer, setTrainer] = useState('');
    const [stravaConnected, setStravaConnected] = useState(false);
    const [acceptedCoC, setAcceptedCoC] = useState(false);
    const [acceptedDataPolicy, setAcceptedDataPolicy] = useState(false);
    const [acceptedPublicResults, setAcceptedPublicResults] = useState(false);

    // Verification Data
    const [weightVerificationStatus, setWeightVerificationStatus] = useState<'none' | 'pending' | 'submitted' | 'approved' | 'rejected'>('none');
    const [weightVerificationVideoLink, setWeightVerificationVideoLink] = useState('');
    const [weightVerificationDeadline, setWeightVerificationDeadline] = useState<any>(null);
    const [verificationRequests, setVerificationRequests] = useState<any[]>([]);

    // Policy Versions
    const [requiredDataPolicyVersion, setRequiredDataPolicyVersion] = useState<string | null>(null);
    const [requiredPublicResultsConsentVersion, setRequiredPublicResultsConsentVersion] = useState<string | null>(null);

    // Lists & Loading
    const [clubs, setClubs] = useState<{ name: string; district: string; type: string }[]>([]);
    const [loadingClubs, setLoadingClubs] = useState(true);
    const [clubsError, setClubsError] = useState('');
    const [trainers, setTrainers] = useState<{ id: string; name: string; status: string; dualRecordingRequired: boolean }[]>([]);
    const [loadingTrainers, setLoadingTrainers] = useState(true);
    const [trainersError, setTrainersError] = useState('');

    // Helper State
    const [initialData, setInitialData] = useState<{ eLicense?: string, zwiftId?: string }>({});
    const [zwiftVerified, setZwiftVerified] = useState(false);
    const [verifyingZwift, setVerifyingZwift] = useState(false);
    const [zwiftName, setZwiftName] = useState('');
    const [zwiftError, setZwiftError] = useState('');
    const [checkingLicense, setCheckingLicense] = useState(false);
    const [licenseAvailable, setLicenseAvailable] = useState(true);
    const [licenseCheckMessage, setLicenseCheckMessage] = useState('');

    // UI Structure
    const [isRegistered, setIsRegistered] = useState(false);
    const [fetchingProfile, setFetchingProfile] = useState(true);
    const [activeTab, setActiveTab] = useState('info'); // 'info', 'connections', 'agreements', 'verification'
    const [currentStep, setCurrentStep] = useState(0); // 0: Info, 1: Connections, 2: Agreements

    const [submitting, setSubmitting] = useState(false);
    const [savingProgress, setSavingProgress] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    // --- Effects ---

    // Redirect if not logged in
    useEffect(() => {
        if (!authLoading && !user) router.push('/');
    }, [user, authLoading, router]);

    // Fetch Lists
    useEffect(() => {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
        fetch(`${apiUrl}/clubs`).then(res => res.json()).then(d => { setClubs(d.clubs || []); setLoadingClubs(false); }).catch(() => { setClubsError('Failed to load clubs'); setLoadingClubs(false); });
        fetch(`${apiUrl}/trainers`).then(res => res.json()).then(d => { setTrainers(d.trainers || []); setLoadingTrainers(false); }).catch(() => { setTrainersError('Failed to load trainers'); setLoadingTrainers(false); });
    }, []);

    // Fetch Profile
    useEffect(() => {
        const fetchProfile = async () => {
            if (!user) return;
            try {
                const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
                const idToken = await user.getIdToken();
                const res = await fetch(`${apiUrl}/profile`, { headers: { 'Authorization': `Bearer ${idToken}` } });
                if (res.ok) {
                    const data = await res.json();
                    setRequiredDataPolicyVersion(data.requiredDataPolicyVersion || null);
                    setRequiredPublicResultsConsentVersion(data.requiredPublicResultsConsentVersion || null);

                    if (data.registered || data.hasDraft) {
                        setELicense(data.eLicense || '');
                        setName(data.name || '');
                        setZwiftId(data.zwiftId || '');
                        setClub(data.club || '');
                        setTrainer(data.trainer || '');
                        setStravaConnected(data.stravaConnected || false);
                        setAcceptedCoC(data.acceptedCoC || false);
                        setAcceptedDataPolicy(!!data.acceptedDataPolicy && data.dataPolicyVersion === data.requiredDataPolicyVersion);
                        setAcceptedPublicResults(!!data.acceptedPublicResults && data.publicResultsConsentVersion === data.requiredPublicResultsConsentVersion);

                        setWeightVerificationStatus(data.weightVerificationStatus || 'none');
                        setWeightVerificationVideoLink(data.weightVerificationVideoLink || '');
                        setWeightVerificationDeadline(data.weightVerificationDeadline || null);
                        setVerificationRequests(data.verificationRequests || []);

                        setInitialData({ eLicense: data.eLicense, zwiftId: data.zwiftId });
                        if (data.zwiftId) setZwiftVerified(true);
                        setIsRegistered(data.registered);

                        if (data.hasDraft && !data.registered) {
                            setMessage('Welcome back! Draft loaded.');
                        }
                    } else if (user.displayName) {
                        setName(user.displayName);
                    }
                }
            } catch (e) {
                console.error(e);
            } finally {
                setFetchingProfile(false);
            }
        };
        if (user && !authLoading) fetchProfile();
    }, [user, authLoading]);

    // Handle Strava Return
    useEffect(() => {
        if (stravaStatusParam === 'connected') {
            setStravaConnected(true);
            setMessage('Strava connected successfully!');
            // Restore temp info
            const tempName = localStorage.getItem('temp_reg_name');
            if (tempName) {
                setName(tempName || '');
                setELicense(localStorage.getItem('temp_reg_elicense') || '');
                setZwiftId(localStorage.getItem('temp_reg_zwiftid') || '');
                setClub(localStorage.getItem('temp_reg_club') || '');
                setTrainer(localStorage.getItem('temp_reg_trainer') || '');
                // Cleanup will happen when they save/submit
            }
        }
    }, [stravaStatusParam]);


    // --- Actions ---

    const checkLicense = async () => {
        if (!eLicense || eLicense === initialData.eLicense) { setLicenseAvailable(true); setLicenseCheckMessage(''); return; }
        setCheckingLicense(true);
        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/verify/elicense/${eLicense}`);
            const data = await res.json();
            setLicenseAvailable(data.available);
            setLicenseCheckMessage(!data.available ? 'License already used.' : '');
        } catch { setLicenseCheckMessage('Error checking license'); }
        finally { setCheckingLicense(false); }
    };

    const verifyZwiftId = async () => {
        if (!zwiftId) return;
        setVerifyingZwift(true); setZwiftError('');
        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/verify/zwift/${zwiftId}`);
            const data = await res.json();
            if (res.ok) { setZwiftName(`${data.firstName} ${data.lastName}`); }
            else { setZwiftError(data.message || 'Could not verify ID'); }
        } catch { setZwiftError('Network error verifying ID'); }
        finally { setVerifyingZwift(false); }
    };

    const confirmZwiftIdentity = () => { setZwiftVerified(true); setZwiftName(''); };

    // Reset verification if ID changes
    useEffect(() => {
        if (zwiftId !== initialData.zwiftId && zwiftVerified) setZwiftVerified(false);
    }, [zwiftId, initialData.zwiftId]);

    const handleConnectStrava = async () => {
        if (!eLicense && !zwiftId) { setError("Enter Zwift ID or E-License first"); return; }
        // Save temp state
        localStorage.setItem('temp_reg_name', name);
        localStorage.setItem('temp_reg_elicense', eLicense);
        localStorage.setItem('temp_reg_zwiftid', zwiftId);
        localStorage.setItem('temp_reg_club', club);
        localStorage.setItem('temp_reg_trainer', trainer);

        try {
            const token = await user?.getIdToken();
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/strava/login`, {
                method: 'POST', body: JSON.stringify({ eLicense, zwiftId }), headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            const data = await res.json();
            if (data.url) window.location.href = data.url;
            else throw new Error(data.message);
        } catch (e: any) { setError(e.message); }
    };

    const handleDisconnectStrava = async () => {
        try {
            const token = await user?.getIdToken();
            await fetch(`${process.env.NEXT_PUBLIC_API_URL}/strava/deauthorize`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
            setStravaConnected(false);
            showToast('Strava disconnected', 'success');
        } catch (e: any) { setError(e.message); }
    };

    const handleRequestTrainer = async (tName: string) => {
        try {
            const token = await user?.getIdToken();
            await fetch(`${process.env.NEXT_PUBLIC_API_URL}/trainers/request`, {
                method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ trainerName: tName, requesterName: name })
            });
            setMessage('Trainer requested!');
        } catch (e: any) { setError(e.message); }
    };

    const saveData = async (isDraft: boolean) => {
        if (!user) return;
        if (!isDraft) setSubmitting(true); else setSavingProgress(true);
        setError(''); setMessage('');

        try {
            const token = await user.getIdToken();
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/signup`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    eLicense, name, zwiftId, club, trainer,
                    acceptedCoC, acceptedDataPolicy, acceptedPublicResults,
                    dataPolicyVersion: requiredDataPolicyVersion,
                    publicResultsConsentVersion: requiredPublicResultsConsentVersion,
                    uid: user.uid,
                    draft: isDraft
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);

            setInitialData({ eLicense, zwiftId });
            setMessage(isDraft ? 'Progress saved.' : 'Profile updated!');
            showToast(isDraft ? 'Progress saved' : 'Saved!', 'success');

            if (!isDraft) {
                setIsRegistered(true);
                await refreshProfile();
            }
        } catch (e: any) { setError(e.message); }
        finally { setSubmitting(false); setSavingProgress(false); }
    };

    // Validation
    const step0Valid = !!name && !!club && !!trainer && !!eLicense && licenseAvailable;
    const step1Valid = !!zwiftId && zwiftVerified; // Strava optional
    const step2Valid = acceptedCoC && acceptedDataPolicy && acceptedPublicResults;

    // --- Render ---

    if (authLoading || fetchingProfile) return <div className="p-8 text-center text-muted-foreground">Loading profile...</div>;

    const TabButton = ({ id, label, active, warning = false }: any) => (
        <button
            onClick={() => setActiveTab(id)}
            className={`flex-1 pb-3 text-sm font-medium border-b-2 transition-colors ${active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                } ${warning ? 'text-orange-600 dark:text-orange-400' : ''}`}
        >
            {label} {warning && '⚠️'}
        </button>
    );

    return (
        <div className="max-w-2xl mx-auto mt-10 p-8 bg-card rounded-lg shadow-md border border-border">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold text-card-foreground">
                    {isRegistered ? 'Rider Profile' : 'Registration'}
                </h1>
                {!isRegistered && (
                    <button
                        onClick={() => saveData(true)}
                        disabled={savingProgress}
                        className="text-sm text-muted-foreground hover:text-primary underline"
                    >
                        {savingProgress ? 'Saving...' : 'Save Draft'}
                    </button>
                )}
            </div>

            {message && <div className="bg-green-50 text-green-700 p-4 rounded mb-6 border border-green-200">{message}</div>}
            {error && <div className="bg-red-50 text-red-700 p-4 rounded mb-6 border border-red-200">{error}</div>}

            {/* TABBED INTERFACE (Registered Users) */}
            {isRegistered && (
                <>
                    <div className="flex gap-2 mb-6 border-b border-border">
                        <TabButton id="info" label="Rider Info" active={activeTab === 'info'} />
                        <TabButton id="connections" label="Connections" active={activeTab === 'connections'} />
                        <TabButton id="agreements" label="Agreements" active={activeTab === 'agreements'} />
                        <TabButton
                            id="verification"
                            label="Verification"
                            active={activeTab === 'verification'}
                            warning={weightVerificationStatus === 'pending'}
                        />
                    </div>

                    <div className="min-h-[300px]">
                        {activeTab === 'info' && (
                            <RiderInfoForm
                                name={name} setName={setName} eLicense={eLicense} setELicense={setELicense}
                                club={club} setClub={setClub} trainer={trainer} setTrainer={setTrainer}
                                clubs={clubs} loadingClubs={loadingClubs} clubsError={clubsError}
                                trainers={trainers} loadingTrainers={loadingTrainers} trainersError={trainersError}
                                licenseAvailable={licenseAvailable} checkingLicense={checkingLicense}
                                checkLicense={checkLicense} licenseCheckMessage={licenseCheckMessage}
                                onRequestTrainer={handleRequestTrainer}
                                // Zwift Props
                                zwiftId={zwiftId} setZwiftId={setZwiftId} zwiftVerified={zwiftVerified} verifyingZwift={verifyingZwift}
                                zwiftName={zwiftName} zwiftError={zwiftError} verifyZwiftId={verifyZwiftId} confirmZwiftIdentity={confirmZwiftIdentity}
                            />
                        )}
                        {activeTab === 'connections' && (
                            <ConnectionsForm
                                stravaConnected={stravaConnected} handleConnectStrava={handleConnectStrava} handleDisconnectStrava={handleDisconnectStrava}
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
                    {/* Stepper Progress */}
                    <div className="flex items-center justify-between mb-8 relative">
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1 bg-secondary rounded-full -z-10" />
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm bg-background border-2 ${currentStep >= 0 ? 'border-primary text-primary' : 'border-muted text-muted-foreground'}`}>1</div>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm bg-background border-2 ${currentStep >= 1 ? 'border-primary text-primary' : 'border-muted text-muted-foreground'}`}>2</div>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm bg-background border-2 ${currentStep >= 2 ? 'border-primary text-primary' : 'border-muted text-muted-foreground'}`}>3</div>
                    </div>

                    <div className="min-h-[300px]">
                        {currentStep === 0 && (
                            <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                                <h2 className="text-xl font-semibold mb-4 text-card-foreground">Rider Information</h2>
                                <RiderInfoForm
                                    name={name} setName={setName} eLicense={eLicense} setELicense={setELicense}
                                    club={club} setClub={setClub} trainer={trainer} setTrainer={setTrainer}
                                    clubs={clubs} loadingClubs={loadingClubs} clubsError={clubsError}
                                    trainers={trainers} loadingTrainers={loadingTrainers} trainersError={trainersError}
                                    licenseAvailable={licenseAvailable} checkingLicense={checkingLicense}
                                    checkLicense={checkLicense} licenseCheckMessage={licenseCheckMessage}
                                    onRequestTrainer={handleRequestTrainer}
                                    // Zwift Props
                                    zwiftId={zwiftId} setZwiftId={setZwiftId} zwiftVerified={zwiftVerified} verifyingZwift={verifyingZwift}
                                    zwiftName={zwiftName} zwiftError={zwiftError} verifyZwiftId={verifyZwiftId} confirmZwiftIdentity={confirmZwiftIdentity}
                                />
                            </div>
                        )}
                        {currentStep === 1 && (
                            <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                                <h2 className="text-xl font-semibold mb-4 text-card-foreground">Connect Accounts</h2>
                                <ConnectionsForm
                                    stravaConnected={stravaConnected} handleConnectStrava={handleConnectStrava} handleDisconnectStrava={handleDisconnectStrava}
                                />
                            </div>
                        )}
                        {currentStep === 2 && (
                            <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                                <h2 className="text-xl font-semibold mb-4 text-card-foreground">Agreements</h2>
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
                        className="px-6 py-2 bg-primary text-primary-foreground font-bold rounded-lg hover:bg-primary/90 disabled:opacity-50"
                    >
                        {submitting ? 'Saving...' : 'Save Changes'}
                    </button>
                ) : (
                    <>
                        {currentStep > 0 && (
                            <button
                                onClick={() => setCurrentStep(prev => prev - 1)}
                                className="px-6 py-2 border border-border rounded-lg hover:bg-secondary transition-colors"
                            >
                                Back
                            </button>
                        )}
                        {currentStep < 2 ? (
                            <button
                                onClick={() => setCurrentStep(prev => prev + 1)}
                                disabled={currentStep === 0 ? !step0Valid : !step1Valid}
                                className="px-6 py-2 bg-primary text-primary-foreground font-bold rounded-lg hover:bg-primary/90 disabled:opacity-50"
                            >
                                Next
                            </button>
                        ) : (
                            <button
                                onClick={() => saveData(false)}
                                disabled={submitting || !step2Valid}
                                className="px-8 py-2 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 disabled:opacity-50"
                            >
                                {submitting ? 'Registering...' : 'Complete Registration'}
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
        <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading...</div>}>
            <RegisterContent />
        </Suspense>
    );
}
