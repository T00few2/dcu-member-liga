'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/components/ToastProvider';

import { API_URL } from '@/lib/api';

export function useRegistration() {
    const { user, loading: authLoading, refreshProfile } = useAuth();
    const { showToast } = useToast();
    const router = useRouter();
    const searchParams = useSearchParams();
    const stravaStatusParam = searchParams.get('strava');
    const zwiftStatusParam = searchParams.get('zwift');

    // User Data
    const [name, setName] = useState('');
    const [zwiftId, setZwiftId] = useState('');
    const [club, setClub] = useState('');
    const [trainer, setTrainer] = useState('');
    const [stravaConnected, setStravaConnected] = useState(false);
    const [zwiftConnected, setZwiftConnected] = useState(false);
    const [acceptedCoC, setAcceptedCoC] = useState(false);
    const [acceptedDataPolicy, setAcceptedDataPolicy] = useState(false);
    const [acceptedPublicResults, setAcceptedPublicResults] = useState(false);

    // Verification Data
    const [weightVerificationStatus, setWeightVerificationStatus] = useState<'none' | 'pending' | 'submitted' | 'approved' | 'rejected'>('none');
    const [weightVerificationVideoLink, setWeightVerificationVideoLink] = useState('');
    const [weightVerificationDeadline, setWeightVerificationDeadline] = useState<{ seconds: number; nanoseconds: number } | string | null>(null);
    const [verificationRequests, setVerificationRequests] = useState<{ requestId: string; status: 'pending' | 'submitted' | 'approved' | 'rejected'; requestedAt?: { seconds: number } | string | null; videoLink?: string; rejectionReason?: string; deadline?: { seconds: number } | string | null }[]>([]);

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
    const [initialData, setInitialData] = useState<{ zwiftId?: string }>({});
    const [zwiftVerified, setZwiftVerified] = useState(false);
    const [verifyingZwift, setVerifyingZwift] = useState(false);
    const [zwiftName, setZwiftName] = useState('');
    const [zwiftError, setZwiftError] = useState('');

    // UI State
    const [isRegistered, setIsRegistered] = useState(false);
    const [fetchingProfile, setFetchingProfile] = useState(true);
    const [activeTab, setActiveTab] = useState('info');
    const [currentStep, setCurrentStep] = useState(0);
    const [submitting, setSubmitting] = useState(false);
    const [savingProgress, setSavingProgress] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    // --- Effects ---

    useEffect(() => {
        fetch(`${API_URL}/clubs`)
            .then(res => res.json())
            .then(d => { setClubs(d.clubs || []); setLoadingClubs(false); })
            .catch(() => { setClubsError('Failed to load clubs'); setLoadingClubs(false); });
        fetch(`${API_URL}/trainers`)
            .then(res => res.json())
            .then(d => { setTrainers(d.trainers || []); setLoadingTrainers(false); })
            .catch(() => { setTrainersError('Failed to load trainers'); setLoadingTrainers(false); });
    }, []);

    useEffect(() => {
        const fetchProfile = async () => {
            if (!user) return;
            try {
                const idToken = await user.getIdToken();
                const res = await fetch(`${API_URL}/profile`, {
                    headers: { 'Authorization': `Bearer ${idToken}` },
                });
                if (res.ok) {
                    const data = await res.json();
                    setRequiredDataPolicyVersion(data.requiredDataPolicyVersion || null);
                    setRequiredPublicResultsConsentVersion(data.requiredPublicResultsConsentVersion || null);

                    if (data.registered || data.hasDraft) {
                        setName(data.name || '');
                        setZwiftId(data.zwiftId || '');
                        setClub(data.club || '');
                        setTrainer(data.trainer || '');
                        setStravaConnected(data.stravaConnected || false);
                        setZwiftConnected(data.zwiftConnected || false);
                        setAcceptedCoC(data.acceptedCoC || false);
                        setAcceptedDataPolicy(!!data.acceptedDataPolicy && data.dataPolicyVersion === data.requiredDataPolicyVersion);
                        setAcceptedPublicResults(!!data.acceptedPublicResults && data.publicResultsConsentVersion === data.requiredPublicResultsConsentVersion);
                        setWeightVerificationStatus(data.weightVerificationStatus || 'none');
                        setWeightVerificationVideoLink(data.weightVerificationVideoLink || '');
                        setWeightVerificationDeadline(data.weightVerificationDeadline || null);
                        setVerificationRequests(data.verificationRequests || []);
                        setInitialData({ zwiftId: data.zwiftId });
                        if (data.zwiftId) setZwiftVerified(true);
                        setIsRegistered(data.registered);
                        if (data.hasDraft && !data.registered) setMessage('Velkommen tilbage! Kladde indlæst.');
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

    useEffect(() => {
        if (stravaStatusParam === 'connected') {
            setStravaConnected(true);
            setMessage('Strava forbundet med succes!');
            setActiveTab('connections');
            setCurrentStep(1);
            const tempName = localStorage.getItem('temp_reg_name');
            if (tempName) {
                setName(tempName);
                setZwiftId(localStorage.getItem('temp_reg_zwiftid') || '');
                setClub(localStorage.getItem('temp_reg_club') || '');
                setTrainer(localStorage.getItem('temp_reg_trainer') || '');
            }
        }
    }, [stravaStatusParam]);

    useEffect(() => {
        if (zwiftStatusParam === 'connected') {
            setZwiftConnected(true);
            setMessage('Zwift forbundet med succes!');
            setActiveTab('connections');
            setCurrentStep(1);
            const tempName = localStorage.getItem('temp_reg_name');
            if (tempName) {
                setName(tempName);
                setZwiftId(localStorage.getItem('temp_reg_zwiftid') || '');
                setClub(localStorage.getItem('temp_reg_club') || '');
                setTrainer(localStorage.getItem('temp_reg_trainer') || '');
            }
        }
    }, [zwiftStatusParam]);

    useEffect(() => {
        if (zwiftId !== initialData.zwiftId && zwiftVerified) setZwiftVerified(false);
    }, [zwiftId, initialData.zwiftId]);

    // --- Actions ---

    const verifyZwiftId = async () => {
        if (!zwiftId || !user) return;
        setVerifyingZwift(true);
        setZwiftError('');
        try {
            const token = await user.getIdToken();
            const res = await fetch(`${API_URL}/verify/zwift/${zwiftId}`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            const data = await res.json();
            if (res.ok) setZwiftName(`${data.firstName} ${data.lastName}`);
            else setZwiftError(data.message || 'Could not verify ID');
        } catch {
            setZwiftError('Network error verifying ID');
        } finally {
            setVerifyingZwift(false);
        }
    };

    const confirmZwiftIdentity = () => {
        setZwiftVerified(true);
        setZwiftName('');
    };

    const handleConnectStrava = async () => {
        if (!zwiftId) { setError('Indtast Zwift ID først'); return; }
        localStorage.setItem('temp_reg_name', name);
        localStorage.setItem('temp_reg_zwiftid', zwiftId);
        localStorage.setItem('temp_reg_club', club);
        localStorage.setItem('temp_reg_trainer', trainer);
        try {
            const token = await user?.getIdToken();
            const res = await fetch(`${API_URL}/strava/login`, {
                method: 'POST',
                body: JSON.stringify({ zwiftId }),
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            });
            const data = await res.json();
            if (data.url) window.location.href = data.url;
            else throw new Error(data.message);
        } catch (e: any) {
            setError(e.message);
        }
    };

    const handleConnectZwift = async () => {
        if (!zwiftId) { setError('Indtast Zwift ID først'); return; }
        localStorage.setItem('temp_reg_name', name);
        localStorage.setItem('temp_reg_zwiftid', zwiftId);
        localStorage.setItem('temp_reg_club', club);
        localStorage.setItem('temp_reg_trainer', trainer);
        try {
            const token = await user?.getIdToken();
            const res = await fetch(`${API_URL}/zwift/login`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ promptLogin: true }),
            });
            const data = await res.json();
            if (data.url) window.location.href = data.url;
            else throw new Error(data.message || 'Failed to start Zwift OAuth');
        } catch (e: any) {
            setError(e.message);
        }
    };

    const handleDisconnectZwift = async () => {
        try {
            const token = await user?.getIdToken();
            await fetch(`${API_URL}/zwift/deauthorize`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
            });
            setZwiftConnected(false);
            setZwiftVerified(false);
            showToast('Zwift disconnected', 'success');
        } catch (e: any) {
            setError(e.message);
        }
    };

    const handleDisconnectStrava = async () => {
        try {
            const token = await user?.getIdToken();
            await fetch(`${API_URL}/strava/deauthorize`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
            });
            setStravaConnected(false);
            showToast('Strava disconnected', 'success');
        } catch (e: any) {
            setError(e.message);
        }
    };

    const handleRequestTrainer = async (tName: string) => {
        try {
            const token = await user?.getIdToken();
            await fetch(`${API_URL}/trainers/request`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ trainerName: tName, requesterName: name }),
            });
            setMessage('Trainer requested!');
        } catch (e: any) {
            setError(e.message);
        }
    };

    const saveData = async (isDraft: boolean) => {
        if (!user) return;
        if (!isDraft) setSubmitting(true); else setSavingProgress(true);
        setError('');
        setMessage('');
        try {
            const token = await user.getIdToken();
            const res = await fetch(`${API_URL}/signup`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name, zwiftId, club, trainer,
                    acceptedCoC, acceptedDataPolicy, acceptedPublicResults,
                    dataPolicyVersion: requiredDataPolicyVersion,
                    publicResultsConsentVersion: requiredPublicResultsConsentVersion,
                    uid: user.uid,
                    draft: isDraft,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);
            setInitialData({ zwiftId });
            setMessage(isDraft ? 'Kladde gemt.' : 'Profil opdateret!');
            showToast(isDraft ? 'Kladde gemt' : 'Gemt!', 'success');
            if (!isDraft) {
                setIsRegistered(true);
                await refreshProfile();
                router.push('/');
            }
        } catch (e: any) {
            setError(e.message);
        } finally {
            setSubmitting(false);
            setSavingProgress(false);
        }
    };

    // Validation
    const step0Valid = !!name && !!club && !!trainer;
    const step1Valid = !!zwiftId && zwiftVerified;
    const step2Valid = acceptedCoC && acceptedDataPolicy && acceptedPublicResults;

    return {
        // Auth
        authLoading,
        fetchingProfile,
        // User Data
        name, setName,
        zwiftId, setZwiftId,
        club, setClub,
        trainer, setTrainer,
        stravaConnected,
        zwiftConnected,
        acceptedCoC, setAcceptedCoC,
        acceptedDataPolicy, setAcceptedDataPolicy,
        acceptedPublicResults, setAcceptedPublicResults,
        // Verification
        weightVerificationStatus,
        weightVerificationVideoLink,
        weightVerificationDeadline,
        verificationRequests,
        refreshProfile,
        // Lists
        clubs, loadingClubs, clubsError,
        trainers, loadingTrainers, trainersError,
        // Zwift helpers
        zwiftVerified, verifyingZwift, zwiftName, zwiftError,
        // UI
        isRegistered,
        activeTab, setActiveTab,
        currentStep, setCurrentStep,
        submitting, savingProgress,
        message, error,
        // Validation
        step0Valid, step1Valid, step2Valid,
        // Actions
        verifyZwiftId,
        confirmZwiftIdentity,
        handleConnectStrava,
        handleDisconnectStrava,
        handleConnectZwift,
        handleDisconnectZwift,
        handleRequestTrainer,
        saveData,
    };
}
