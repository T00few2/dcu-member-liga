'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/components/ToastProvider';

import { API_URL } from '@/lib/api';
import type { ClubKitPayload } from '@/lib/clubKitCopy';

export function useRegistration() {
    const { user, loading: authLoading, refreshProfile } = useAuth();
    const { showToast } = useToast();
    const router = useRouter();
    const searchParams = useSearchParams();
    const stravaStatusParam = searchParams.get('strava');
    const zwiftStatusParam = searchParams.get('zwift');
    const discordStatusParam = searchParams.get('discord');
    const discordStateParam = searchParams.get('state');
    const discordTokenParam = searchParams.get('token');
    const discordConfirmed = useRef(false);

    // User Data
    const [name, setName] = useState('');
    const [zwiftId, setZwiftId] = useState('');
    const [club, setClub] = useState('');
    const [trainer, setTrainer] = useState('');
    const [stravaConnected, setStravaConnected] = useState(false);
    const [zwiftConnected, setZwiftConnected] = useState(false);
    // Linked Discord username (null when not linked); used by the help-channel bot.
    const [discordUsername, setDiscordUsername] = useState<string | null>(null);
    const [acceptedCoC, setAcceptedCoC] = useState(false);
    const [acceptedDataPolicy, setAcceptedDataPolicy] = useState(false);
    const [acceptedPublicResults, setAcceptedPublicResults] = useState(false);

    // Verification Data
    const [weightVerificationStatus, setWeightVerificationStatus] = useState<'none' | 'pending' | 'submitted' | 'approved' | 'rejected'>('none');
    const [weightVerificationVideoLink, setWeightVerificationVideoLink] = useState('');
    const [weightVerificationDeadline, setWeightVerificationDeadline] = useState<{ seconds: number; nanoseconds: number } | string | null>(null);
    const [verificationRequests, setVerificationRequests] = useState<{
        requestId: string;
        status: 'pending' | 'submitted' | 'approved' | 'rejected';
        requestedAt?: { seconds: number } | string | null;
        submittedAt?: { seconds: number } | string | null;
        videoLink?: string;
        rejectionReason?: string;
        deadline?: { seconds: number } | string | null;
        weighInDate?: string;
        source?: string;
    }[]>([]);
    const [dualRecordingOptIn, setDualRecordingOptIn] = useState(false);
    const [ligaCategory, setLigaCategory] = useState<string | null>(null);
    const [clubKit, setClubKit] = useState<ClubKitPayload | null>(null);
    const [dropLevel, setDropLevel] = useState<number | null>(null);

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

    // UI State
    const [isRegistered, setIsRegistered] = useState(false);
    const [fetchingProfile, setFetchingProfile] = useState(true);
    const [activeTab, setActiveTab] = useState('info');
    const [currentStep, setCurrentStep] = useState(0);
    const [submitting, setSubmitting] = useState(false);
    const [savingProgress, setSavingProgress] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [profileTick, setProfileTick] = useState(0);

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

    // Keep in-progress rider info locally so OAuth redirects and reloads do not wipe input.
    // Skip the first run: it would overwrite the saved draft with the empty initial state
    // before the return-from-OAuth effects below restore it.
    const persistReady = useRef(false);
    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!persistReady.current) {
            persistReady.current = true;
            return;
        }
        localStorage.setItem('temp_reg_name', name || '');
        localStorage.setItem('temp_reg_club', club || '');
        localStorage.setItem('temp_reg_trainer', trainer || '');
    }, [name, club, trainer]);

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

                    if (data.registered || data.hasDraft || data.zwiftConnected || data.zwiftId) {
                        const tempName = typeof window !== 'undefined' ? (localStorage.getItem('temp_reg_name') || '').trim() : '';
                        const backendName = (data.name || '').trim();
                        setName(prev => {
                            if (backendName) return backendName;
                            if ((prev || '').trim()) return prev;
                            if (tempName) return tempName;
                            return user.displayName || '';
                        });
                        setZwiftId(data.zwiftId || '');
                        setClub(data.club || '');
                        setTrainer(data.trainer || '');
                        setStravaConnected(data.stravaConnected || false);
                        setZwiftConnected(data.zwiftConnected || false);
                        setDiscordUsername(data.discordUsername ?? null);
                        setAcceptedCoC(data.acceptedCoC || false);
                        setAcceptedDataPolicy(!!data.acceptedDataPolicy && data.dataPolicyVersion === data.requiredDataPolicyVersion);
                        setAcceptedPublicResults(!!data.acceptedPublicResults && data.publicResultsConsentVersion === data.requiredPublicResultsConsentVersion);
                        setWeightVerificationStatus(data.weightVerificationStatus || 'none');
                        setWeightVerificationVideoLink(data.weightVerificationVideoLink || '');
                        setWeightVerificationDeadline(data.weightVerificationDeadline || null);
                        setVerificationRequests(data.verificationRequests || []);
                        setDualRecordingOptIn(!!data.dualRecordingOptIn);
                        setLigaCategory(data.ligaCategory?.category || null);
                        setClubKit(data.clubKit || null);
                        setDropLevel(typeof data.dropLevel === 'number' ? data.dropLevel : null);
                        setInitialData({ zwiftId: data.zwiftId });
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
    }, [user, authLoading, profileTick]);

    useEffect(() => {
        if (stravaStatusParam === 'connected') {
            setStravaConnected(true);
            setMessage('Strava forbundet med succes!');
            setActiveTab('connections');
            setCurrentStep(1);
            const tempName = localStorage.getItem('temp_reg_name');
            if (tempName) {
                setName(tempName);
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
                setClub(localStorage.getItem('temp_reg_club') || '');
                setTrainer(localStorage.getItem('temp_reg_trainer') || '');
            }
        }
    }, [zwiftStatusParam]);

    useEffect(() => {
        if (!discordStatusParam) return;
        // Back from Discord: same step and in-progress fields as after Strava / Zwift.
        setActiveTab('connections');
        setCurrentStep(1);
        const tempName = localStorage.getItem('temp_reg_name');
        if (tempName) {
            setName(tempName);
            setClub(localStorage.getItem('temp_reg_club') || '');
            setTrainer(localStorage.getItem('temp_reg_trainer') || '');
        }
        showDiscordStatus(discordStatusParam);
    }, [discordStatusParam]);

    // Back from Discord: the link is only made when this logged-in rider confirms it.
    useEffect(() => {
        if (discordStatusParam !== 'confirm' || !discordStateParam || !user || discordConfirmed.current) return;
        discordConfirmed.current = true;
        (async () => {
            try {
                const token = await user.getIdToken();
                const res = await fetch(`${API_URL}/discord/confirm`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ state: discordStateParam, token: discordTokenParam }),
                });
                const data = await res.json().catch(() => ({}));
                if (data.status === 'connected') {
                    setDiscordUsername(data.username || null);
                    setProfileTick((tick) => tick + 1); // a profile read that raced the link sees it now
                }
                showDiscordStatus(data.status || 'error');
            } catch {
                showDiscordStatus('error');
            }
            // The state is spent: drop it (and the token) from the URL so a refresh does nothing.
            router.replace('/register', { scroll: false });
        })();
    }, [discordStatusParam, discordStateParam, discordTokenParam, user, router]);

    function showDiscordStatus(status: string) {
        if (status === 'confirm') return; // the confirm effect reports the outcome
        if (status === 'connected') setMessage('Discord forbundet!');
        else if (status === 'taken') setError('Den Discord-konto er allerede forbundet til en anden rytter.');
        else if (status === 'cancelled') setError('Discord-forbindelsen blev afbrudt.');
        else if (status === 'expired') setError('Discord-login udløb. Prøv igen.');
        else if (status === 'mismatch') setError('Discord-forbindelsen blev startet af en anden konto. Start den igen her.');
        else setError('Discord-forbindelsen mislykkedes. Prøv igen.');
    }

    // --- Actions ---

    const handleConnectDiscord = async () => {
        localStorage.setItem('temp_reg_name', name);
        localStorage.setItem('temp_reg_club', club);
        localStorage.setItem('temp_reg_trainer', trainer);
        try {
            const token = await user?.getIdToken();
            const res = await fetch(`${API_URL}/discord/login`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            const data = await res.json();
            if (data.url) window.location.href = data.url;
            else throw new Error(data.message || 'Kunne ikke starte Discord-forbindelsen');
        } catch (e: any) {
            setError(e.message);
        }
    };

    const handleDisconnectDiscord = async () => {
        try {
            const token = await user?.getIdToken();
            const res = await fetch(`${API_URL}/discord/unlink`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (!res.ok) throw new Error('Kunne ikke frakoble Discord');
            setDiscordUsername(null);
            showToast('Discord frakoblet', 'success');
        } catch (e: any) {
            setError(e.message);
        }
    };

    const handleConnectStrava = async () => {
        localStorage.setItem('temp_reg_name', name);
        localStorage.setItem('temp_reg_club', club);
        localStorage.setItem('temp_reg_trainer', trainer);
        try {
            const token = await user?.getIdToken();
            const res = await fetch(`${API_URL}/strava/login`, {
                method: 'POST',
                body: JSON.stringify({}),
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
        localStorage.setItem('temp_reg_name', name);
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
            setZwiftId('');
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
                    name, club, trainer,
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
                localStorage.removeItem('temp_reg_name');
                localStorage.removeItem('temp_reg_club');
                localStorage.removeItem('temp_reg_trainer');
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
    const selectedTrainer = trainers.find(t => t.name === trainer);
    const trainerRequiresDualRecording = !!selectedTrainer?.dualRecordingRequired;
    // Club is only valid when it matches an entry in the loaded list.
    // While clubs are still loading we treat a non-empty value as tentatively valid
    // so that drafts loaded from the server don't flash a false error.
    const clubValid = loadingClubs ? !!club : clubs.some(c => c.name === club);
    const step0Valid = !!name && clubValid && !!trainer;
    const step1Valid = !!zwiftConnected && !!stravaConnected;
    const step2Valid = acceptedCoC && acceptedDataPolicy && acceptedPublicResults;
    const step3Valid = step0Valid && step1Valid && step2Valid;

    const step0MissingItems = [
        ...(!name ? ['Angiv dit fulde navn'] : []),
        ...(!clubValid ? ['Vælg din DCU-klub fra listen'] : []),
        ...(!trainer ? ['Vælg hometrainer/wattmåler'] : []),
    ];
    const step1MissingItems = [
        ...(!zwiftConnected ? ['Forbind din Zwift-konto'] : []),
        ...(!stravaConnected ? ['Forbind din Strava-konto'] : []),
    ];
    const step2MissingItems = [
        ...(!acceptedCoC ? ['Accepter adfærdskodekset'] : []),
        ...(!acceptedDataPolicy ? ['Accepter datapolitikken'] : []),
        ...(!acceptedPublicResults ? ['Accepter offentliggørelse af navn og resultater'] : []),
    ];

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
        dualRecordingOptIn,
        ligaCategory,
        clubKit,
        dropLevel,
        refreshProfile: async () => {
            await refreshProfile();
            setProfileTick((tick) => tick + 1);
        },
        // Lists
        clubs, loadingClubs, clubsError,
        trainers, loadingTrainers, trainersError,
        // UI
        isRegistered,
        activeTab, setActiveTab,
        currentStep, setCurrentStep,
        submitting, savingProgress,
        message, error,
        // Validation
        clubValid,
        step0Valid, step1Valid, step2Valid, step3Valid,
        trainerRequiresDualRecording,
        step0MissingItems, step1MissingItems, step2MissingItems,
        // Actions
        handleConnectStrava,
        handleDisconnectStrava,
        discordUsername,
        handleConnectDiscord,
        handleDisconnectDiscord,
        handleConnectZwift,
        handleDisconnectZwift,
        handleRequestTrainer,
        saveData,
    };
}
