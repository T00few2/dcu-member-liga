'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import StravaAttribution from '@/components/StravaAttribution';

function RegisterContent() {
    const { user, loading: authLoading, refreshProfile } = useAuth();
    const router = useRouter();
    const searchParams = useSearchParams();
    const stravaStatusParam = searchParams.get('strava');

    // Form State
    const [eLicense, setELicense] = useState('');
    const [name, setName] = useState('');
    const [zwiftId, setZwiftId] = useState('');
    const [club, setClub] = useState('');
    const [stravaConnected, setStravaConnected] = useState(false);
    const [acceptedCoC, setAcceptedCoC] = useState(false);
    const [showCoCModal, setShowCoCModal] = useState(false);

    // Clubs State
    const [clubs, setClubs] = useState<{ name: string; district: string; type: string }[]>([]);
    const [loadingClubs, setLoadingClubs] = useState(true);
    const [clubsError, setClubsError] = useState('');
    const [clubSearchTerm, setClubSearchTerm] = useState('');
    const [showClubDropdown, setShowClubDropdown] = useState(false);

    // Trainer State
    const [trainer, setTrainer] = useState('');
    const [trainers, setTrainers] = useState<{ id: string; name: string; status: string; dualRecordingRequired: boolean }[]>([]);
    const [loadingTrainers, setLoadingTrainers] = useState(true);
    const [trainersError, setTrainersError] = useState('');
    const [showRequestTrainerModal, setShowRequestTrainerModal] = useState(false);
    const [requestedTrainerName, setRequestedTrainerName] = useState('');
    const [submittingTrainerRequest, setSubmittingTrainerRequest] = useState(false);

    // Verification State
    const [initialData, setInitialData] = useState<{ eLicense?: string, zwiftId?: string }>({});
    const [zwiftVerified, setZwiftVerified] = useState(false);
    const [verifyingZwift, setVerifyingZwift] = useState(false);
    const [zwiftName, setZwiftName] = useState('');

    const [checkingLicense, setCheckingLicense] = useState(false);
    const [licenseAvailable, setLicenseAvailable] = useState(true);
    const [licenseCheckMessage, setLicenseCheckMessage] = useState('');

    // UI State
    const [isRegistered, setIsRegistered] = useState(false);
    const [hasDraft, setHasDraft] = useState(false);
    const [fetchingProfile, setFetchingProfile] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [savingProgress, setSavingProgress] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    // Redirect if not logged in
    useEffect(() => {
        if (!authLoading && !user) {
            router.push('/');
        }
    }, [user, authLoading, router]);

    // Fetch Clubs List
    useEffect(() => {
        const fetchClubs = async () => {
            try {
                const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
                const res = await fetch(`${apiUrl}/clubs`);
                
                if (res.ok) {
                    const data = await res.json();
                    setClubs(data.clubs || []);
                } else {
                    setClubsError('Failed to load clubs list');
                }
            } catch (err) {
                console.error("Error fetching clubs:", err);
                setClubsError('Failed to load clubs list');
            } finally {
                setLoadingClubs(false);
            }
        };

        fetchClubs();
    }, []);

    // Fetch Trainers List
    useEffect(() => {
        const fetchTrainers = async () => {
            try {
                const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
                const res = await fetch(`${apiUrl}/trainers`);
                
                if (res.ok) {
                    const data = await res.json();
                    setTrainers(data.trainers || []);
                } else {
                    setTrainersError('Failed to load trainers list');
                }
            } catch (err) {
                console.error("Error fetching trainers:", err);
                setTrainersError('Failed to load trainers list');
            } finally {
                setLoadingTrainers(false);
            }
        };

        fetchTrainers();
    }, []);

    // Fetch Profile on Load
    useEffect(() => {
        const fetchProfile = async () => {
            if (!user) return;

            try {
                const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
                const idToken = await user.getIdToken();

                const res = await fetch(`${apiUrl}/profile`, {
                    headers: { 'Authorization': `Bearer ${idToken}` }
                });

                if (res.ok) {
                    const data = await res.json();
                    if (data.registered) {
                        setIsRegistered(true);
                        setName(data.name || '');
                        setELicense(data.eLicense || '');
                        setZwiftId(data.zwiftId || '');
                        setClub(data.club || '');
                        setTrainer(data.trainer || '');
                        setStravaConnected(data.stravaConnected || false);
                        setAcceptedCoC(data.acceptedCoC || false);

                        setInitialData({ eLicense: data.eLicense, zwiftId: data.zwiftId });
                        // Assume existing profile is verified
                        if (data.zwiftId) setZwiftVerified(true);
                    } else if (data.hasDraft) {
                        // User has saved progress
                        setHasDraft(true);
                        setName(data.name || '');
                        setELicense(data.eLicense || '');
                        setZwiftId(data.zwiftId || '');
                        setClub(data.club || '');
                        setTrainer(data.trainer || '');
                        setStravaConnected(data.stravaConnected || false);
                        setAcceptedCoC(data.acceptedCoC || false);
                        setMessage('Welcome back! Your progress has been restored. Complete the remaining steps to finish registration.');
                    } else {
                        // Not registered, but maybe prefill name
                        if (user.displayName) setName(user.displayName);
                    }
                }
            } catch (err) {
                console.error("Error fetching profile:", err);
            } finally {
                setFetchingProfile(false);
            }
        };

        if (user && !authLoading) {
            fetchProfile();
        }
    }, [user, authLoading]);

    // Handle Strava redirect return
    useEffect(() => {
        if (stravaStatusParam === 'connected') {
            setStravaConnected(true);
            setMessage('Strava connected successfully!');
        }
    }, [stravaStatusParam]);

    const handleConnectStrava = async () => {
        if (!eLicense) {
            setError("Please enter your E-License first.");
            return;
        }

        localStorage.setItem('temp_reg_elicense', eLicense);
        localStorage.setItem('temp_reg_name', name);
        localStorage.setItem('temp_reg_zwiftid', zwiftId);
        localStorage.setItem('temp_reg_club', club);
        localStorage.setItem('temp_reg_trainer', trainer);

        try {
            if (!user) throw new Error('Not authenticated');
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
            const idToken = await user.getIdToken();
            const res = await fetch(`${apiUrl}/strava/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify({ eLicense })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to start Strava login');
            if (!data.url) throw new Error('Missing Strava redirect URL');
            window.location.href = data.url;
        } catch (err: any) {
            setError(err.message || 'Failed to connect Strava.');
        }
    };

    const handleDisconnectStrava = async () => {
        if (!user) return;
        setError('');
        setMessage('');
        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
            const idToken = await user.getIdToken();
            const res = await fetch(`${apiUrl}/strava/deauthorize`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                }
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to disconnect Strava');
            setStravaConnected(false);
            setMessage('Strava disconnected.');
        } catch (err: any) {
            setError(err.message || 'Failed to disconnect Strava.');
        }
    };

    // Restore temp state if returning from Strava
    useEffect(() => {
        if (stravaStatusParam) {
            const tempName = localStorage.getItem('temp_reg_name');
            const tempELicense = localStorage.getItem('temp_reg_elicense');
            const tempZwiftId = localStorage.getItem('temp_reg_zwiftid');
            const tempClub = localStorage.getItem('temp_reg_club');
            const tempTrainer = localStorage.getItem('temp_reg_trainer');

            if (tempName) setName(tempName);
            if (tempELicense) setELicense(tempELicense);
            if (tempZwiftId) setZwiftId(tempZwiftId);
            if (tempClub) setClub(tempClub);
            if (tempTrainer) setTrainer(tempTrainer);

            // Cleanup
            localStorage.removeItem('temp_reg_name');
            localStorage.removeItem('temp_reg_elicense');
            localStorage.removeItem('temp_reg_zwiftid');
            localStorage.removeItem('temp_reg_club');
            localStorage.removeItem('temp_reg_trainer');
        }
    }, [stravaStatusParam]);


    // --- VERIFICATION LOGIC ---

    const checkLicense = async () => {
        if (!eLicense || eLicense === initialData.eLicense) {
            setLicenseAvailable(true);
            setLicenseCheckMessage('');
            return;
        }

        setCheckingLicense(true);
        setLicenseCheckMessage('Checking availability...');

        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
            const res = await fetch(`${apiUrl}/verify/elicense/${eLicense}`);
            const data = await res.json();

            if (res.ok) {
                setLicenseAvailable(data.available);
                if (!data.available) {
                    setLicenseCheckMessage('This E-License is already registered.');
                } else {
                    setLicenseCheckMessage('');
                }
            } else {
                // If error, default to allowing but warn? Or fail?
                // Let's fail safe for now but log it
                console.error("License check failed", data);
            }
        } catch (err) {
            console.error("License check error", err);
        } finally {
            setCheckingLicense(false);
        }
    };

    const verifyZwiftId = async () => {
        if (!zwiftId) return;

        // Reset
        setZwiftVerified(false);
        setZwiftName('');
        setVerifyingZwift(true);
        setError('');

        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
            const res = await fetch(`${apiUrl}/verify/zwift/${zwiftId}`);

            if (res.ok) {
                const data = await res.json();
                const fullName = `${data.firstName} ${data.lastName}`;
                setZwiftName(fullName);
                // We don't set zwiftVerified to true yet; user must confirm
            } else {
                const data = await res.json();
                setError(data.message || 'Could not verify Zwift ID. Please check it is correct.');
            }
        } catch (err) {
            setError('Failed to connect to verification service.');
        } finally {
            setVerifyingZwift(false);
        }
    };

    const confirmZwiftIdentity = () => {
        setZwiftVerified(true);
        setZwiftName(''); // Clear name display to clean up UI
    };

    // Reset verification if ID changes
    useEffect(() => {
        if (zwiftId !== initialData.zwiftId && zwiftVerified) {
            setZwiftVerified(false);
        }
    }, [zwiftId, initialData.zwiftId]);

    // Close club dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (showClubDropdown && !target.closest('.club-search-container')) {
                setShowClubDropdown(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showClubDropdown]);


    const handleRequestTrainer = async () => {
        if (!user || !requestedTrainerName.trim()) return;

        setSubmittingTrainerRequest(true);
        setError('');

        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
            const idToken = await user.getIdToken();

            const res = await fetch(`${apiUrl}/trainers/request`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify({
                    trainerName: requestedTrainerName,
                    requesterName: name
                }),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to submit request');

            setMessage('Trainer approval request submitted! We\'ll review it shortly.');
            setShowRequestTrainerModal(false);
            setRequestedTrainerName('');
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSubmittingTrainerRequest(false);
        }
    };

    const handleSaveProgress = async () => {
        if (!user) return;

        setSavingProgress(true);
        setError('');
        setMessage('');

        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
            const idToken = await user.getIdToken();

            const res = await fetch(`${apiUrl}/signup`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify({
                    eLicense: eLicense || null,
                    name: name || null,
                    zwiftId: zwiftId || null,
                    club: club || null,
                    trainer: trainer || null,
                    acceptedCoC,
                    uid: user.uid,
                    draft: true  // Mark as incomplete/draft
                }),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to save progress');

            setMessage('Progress saved! You can return later to complete registration.');

            // Update initial data
            setInitialData({ eLicense, zwiftId });

        } catch (err: any) {
            setError(err.message);
        } finally {
            setSavingProgress(false);
        }
    };

    const handleSubmit = async () => {
        if (!user) return;

        // Final validation for complete registration
        if (!licenseAvailable) {
            setError("E-License is already in use.");
            return;
        }
        if (!zwiftVerified) {
            setError("Please verify your Zwift ID.");
            return;
        }
        if (!club) {
            setError("Please select your club.");
            return;
        }
        if (!trainer) {
            setError("Please select your trainer/powermeter.");
            return;
        }
        if (!acceptedCoC) {
            setError("You must accept the Code of Conduct.");
            return;
        }

        setSubmitting(true);
        setError('');
        setMessage('');

        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
            const idToken = await user.getIdToken();

            const res = await fetch(`${apiUrl}/signup`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify({
                    eLicense,
                    name,
                    zwiftId,
                    club,
                    trainer,
                    acceptedCoC,
                    uid: user.uid,
                    draft: false  // Mark as complete
                }),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Registration failed');

            setIsRegistered(true);
            setMessage(isRegistered ? 'Profile updated!' : 'Registration complete!');

            // Update initial data so we don't prompt to re-verify immediately
            setInitialData({ eLicense, zwiftId });

            // Important: Refresh context so Navbar/Protection updates immediately
            await refreshProfile();

        } catch (err: any) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    // Validation
    const step0Complete = name.length > 0;
    const clubComplete = club.length > 0;
    const trainerComplete = trainer.length > 0;
    const step1Complete = eLicense.length > 0 && licenseAvailable;
    const step2Complete = zwiftVerified && zwiftId.length > 0;
    // Strava is now optional but recommended
    const step3Complete = stravaConnected;
    const step4Complete = acceptedCoC;

    const canSubmit = step0Complete && clubComplete && trainerComplete && step1Complete && step2Complete && step4Complete;
    const missingRequirements = [
        !step0Complete ? 'Name' : null,
        !step1Complete ? (eLicense.length > 0 ? 'E-License must be available' : 'E-License') : null,
        !clubComplete ? 'Club' : null,
        !trainerComplete ? 'Trainer / Powermeter' : null,
        !step2Complete ? 'Zwift ID verification' : null,
        !step4Complete ? 'Code of Conduct acceptance' : null
    ].filter(Boolean) as string[];

    if (authLoading || fetchingProfile) {
        return <div className="p-8 text-center">Loading profile...</div>;
    }

    return (
        <div className="max-w-2xl mx-auto mt-10 p-8 bg-card rounded-lg shadow-md border border-border">
            <h1 className="text-3xl font-bold mb-2 text-card-foreground">
                {isRegistered ? 'Rider Profile' : hasDraft ? 'Continue Registration' : 'Rider Registration'}
            </h1>
            <p className="text-muted-foreground mb-8">
                {isRegistered
                    ? 'Update your details and connections.'
                    : hasDraft
                        ? 'Complete the remaining steps to finish your registration.'
                        : 'Complete the steps below to join the league.'}
            </p>

            {message && (
                <div className="bg-green-50 text-green-700 p-4 rounded-md mb-6 border border-green-200">
                    {message}
                </div>
            )}

            {error && (
                <div className="bg-red-50 text-red-700 p-4 rounded-md mb-6 border border-red-200">
                    {error}
                </div>
            )}

            <div className="space-y-6">

                {/* Step 0: Name (Always required) */}
                <div className={`p-4 border rounded-lg transition-colors ${step0Complete ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800' : 'bg-card border-border'}`}>
                    <div className="flex items-start gap-3">
                        <div className={`mt-1 w-6 h-6 rounded-full flex items-center justify-center text-xs text-white font-bold ${step0Complete ? 'bg-green-500' : 'bg-muted-foreground'}`}>
                            1
                        </div>
                        <div className="flex-1">
                            <label className="block font-semibold text-card-foreground mb-1">Full Name</label>
                            <p className="text-sm text-muted-foreground mb-2">Enter your full name.</p>
                            <input
                                type="text"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                className="w-full p-3 border border-input rounded-lg focus:ring-2 focus:ring-ring focus:border-ring outline-none transition-all text-foreground bg-background placeholder-muted-foreground"
                                placeholder="Your Name"
                            />
                        </div>
                        {step0Complete && <span className="text-green-600 dark:text-green-400 text-xl">✓</span>}
                    </div>
                </div>

                {/* Step 1: Club Selection with Search */}
                <div className={`p-4 border rounded-lg transition-colors ${clubComplete ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800' : 'bg-card border-border'}`}>
                    <div className="flex items-start gap-3">
                        <div className={`mt-1 w-6 h-6 rounded-full flex items-center justify-center text-xs text-white font-bold ${clubComplete ? 'bg-green-500' : 'bg-muted-foreground'}`}>
                            2
                        </div>
                        <div className="flex-1">
                            <label className="block font-semibold text-card-foreground mb-1">DCU Club</label>
                            <p className="text-sm text-muted-foreground mb-2">Select your DCU cycling club or "None" if you don't have one.</p>
                    {loadingClubs ? (
                        <p className="text-sm text-muted-foreground">Loading clubs...</p>
                    ) : clubsError ? (
                        <div>
                            <p className="text-sm text-red-600 mb-2">{clubsError}</p>
                            <select
                                value={club}
                                onChange={e => setClub(e.target.value)}
                                className="w-full p-3 border border-input rounded-lg focus:ring-2 outline-none transition-all text-foreground bg-background"
                            >
                                <option value="">Select your club</option>
                                <option value="None">None</option>
                            </select>
                        </div>
                    ) : (
                        <div className="relative club-search-container">
                            <input
                                type="text"
                                value={club || clubSearchTerm}
                                onChange={(e) => {
                                    setClubSearchTerm(e.target.value);
                                    setClub('');
                                    setShowClubDropdown(true);
                                }}
                                onFocus={() => setShowClubDropdown(true)}
                                placeholder="Search for your club..."
                                        className="w-full p-3 border border-input rounded-lg focus:ring-2 focus:ring-ring focus:border-ring outline-none transition-all text-foreground bg-background placeholder-muted-foreground"
                            />
                            
                            {showClubDropdown && (
                                <div className="absolute z-10 w-full mt-1 max-h-60 overflow-y-auto bg-background border border-border rounded-lg shadow-lg">
                                    {(() => {
                                        const searchLower = (club || clubSearchTerm).toLowerCase();
                                        const filtered = clubs.filter(c => 
                                            c.name.toLowerCase().includes(searchLower) ||
                                            c.type.toLowerCase().includes(searchLower) ||
                                            c.district.toLowerCase().includes(searchLower)
                                        );
                                        
                                        if (filtered.length === 0 && searchLower) {
                                            return (
                                                <>
                                                    <div className="p-3 text-sm text-muted-foreground">
                                                        No clubs found matching "{club || clubSearchTerm}"
                                                    </div>
                                                    <button
                                                        onClick={() => {
                                                            setClub('None');
                                                            setClubSearchTerm('');
                                                            setShowClubDropdown(false);
                                                        }}
                                                        className="w-full p-3 text-left hover:bg-secondary/50 transition-colors border-t border-border"
                                                    >
                                                        <span className="font-medium">None</span>
                                                        <span className="text-xs text-muted-foreground ml-2">(No club)</span>
                                                    </button>
                                                </>
                                            );
                                        }
                                        
                                        return (
                                            <>
                                                {filtered.map((c, idx) => (
                                                    <button
                                                        key={idx}
                                                        onClick={() => {
                                                            setClub(c.name);
                                                            setClubSearchTerm('');
                                                            setShowClubDropdown(false);
                                                        }}
                                                        className="w-full p-3 text-left hover:bg-secondary/50 transition-colors border-b border-border last:border-b-0"
                                                    >
                                                        <div className="font-medium">{c.name}</div>
                                                        <div className="text-xs text-muted-foreground">
                                                            {c.type} • {c.district}
                                                        </div>
                                                    </button>
                                                ))}
                                                <button
                                                    onClick={() => {
                                                        setClub('None');
                                                        setClubSearchTerm('');
                                                        setShowClubDropdown(false);
                                                    }}
                                                    className="w-full p-3 text-left hover:bg-secondary/50 transition-colors border-t border-border bg-secondary/20"
                                                >
                                                    <span className="font-medium">None</span>
                                                    <span className="text-xs text-muted-foreground ml-2">(No club)</span>
                                                </button>
                                            </>
                                        );
                                    })()}
                                </div>
                            )}
                            
                            {club && (
                                <button
                                    onClick={() => {
                                        setClub('');
                                        setClubSearchTerm('');
                                        setShowClubDropdown(true);
                                    }}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                    type="button"
                                >
                                    ✕
                                </button>
                            )}
                        </div>
                    )}
                        </div>
                        {clubComplete && <span className="text-green-600 dark:text-green-400 text-xl">✓</span>}
                    </div>
                </div>

                {/* Step 2: Trainer/Powermeter Selection */}
                <div className={`p-4 border rounded-lg transition-colors ${trainerComplete ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800' : 'bg-card border-border'}`}>
                    <div className="flex items-start gap-3">
                        <div className={`mt-1 w-6 h-6 rounded-full flex items-center justify-center text-xs text-white font-bold ${trainerComplete ? 'bg-green-500' : 'bg-muted-foreground'}`}>
                            3
                        </div>
                        <div className="flex-1">
                            <label className="block font-semibold text-card-foreground mb-1">Trainer / Powermeter</label>
                            <p className="text-sm text-muted-foreground mb-2">Select your trainer or powermeter device.</p>
                            
                            {loadingTrainers ? (
                                <p className="text-sm text-muted-foreground">Loading trainers...</p>
                            ) : trainersError ? (
                                <p className="text-sm text-red-600">{trainersError}</p>
                            ) : (
                                <div className="space-y-3">
                                    <select
                                        value={trainer}
                                        onChange={e => setTrainer(e.target.value)}
                                        className="w-full p-3 border border-input rounded-lg focus:ring-2 focus:ring-ring focus:border-ring outline-none transition-all text-foreground bg-background"
                                    >
                                        <option value="">Select trainer/powermeter</option>
                                        <optgroup label="✓ Approved Trainers">
                                            {trainers
                                                .filter(t => t.status === 'approved')
                                                .map((t) => (
                                                    <option key={t.id} value={t.name}>
                                                        {t.name} {t.dualRecordingRequired ? '(Dual Recording Required)' : ''}
                                                    </option>
                                                ))}
                                        </optgroup>
                                        <optgroup label="✗ Not Approved" disabled>
                                            {trainers
                                                .filter(t => t.status === 'not_approved')
                                                .map((t) => (
                                                    <option key={t.id} value="" disabled>
                                                        {t.name} - NOT APPROVED
                                                    </option>
                                                ))}
                                        </optgroup>
                                    </select>
                                    
                                    {trainer && trainers.find(t => t.name === trainer)?.dualRecordingRequired && (
                                        <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                                            <p className="text-sm text-yellow-800 dark:text-yellow-200">
                                                ⚠️ <strong>Dual Recording Required:</strong> You must record your activities with a second device as verification.
                                            </p>
                                        </div>
                                    )}
                                    
                                    <button
                                        onClick={() => setShowRequestTrainerModal(true)}
                                        className="text-sm text-primary hover:underline"
                                    >
                                        Don't see your trainer? Request approval →
                                    </button>
                                </div>
                            )}
                        </div>
                        {trainerComplete && <span className="text-green-600 dark:text-green-400 text-xl">✓</span>}
                    </div>
                </div>

                {/* Step 3: E-License */}
                <div className={`p-4 border rounded-lg transition-colors ${step1Complete ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800' : 'bg-card border-border'}`}>
                    <div className="flex items-start gap-3">
                        <div className={`mt-1 w-6 h-6 rounded-full flex items-center justify-center text-xs text-white font-bold ${step1Complete ? 'bg-green-500' : 'bg-muted-foreground'}`}>
                            4
                        </div>
                        <div className="flex-1">
                            <label className="block font-semibold text-card-foreground mb-1">DCU E-License</label>
                            <p className="text-sm text-muted-foreground mb-2">Enter your valid DCU E-License number.</p>
                            <input
                                type="text"
                                value={eLicense}
                                onChange={e => setELicense(e.target.value)}
                                onBlur={checkLicense}
                                className={`w-full p-3 border rounded-lg focus:ring-2 outline-none transition-all text-foreground bg-background placeholder-muted-foreground
                            ${!licenseAvailable ? 'border-red-500 focus:ring-red-200' : 'border-input focus:ring-ring focus:border-ring'}`}
                                placeholder="e.g. 100123456"
                            />
                            {checkingLicense && <p className="text-xs text-muted-foreground mt-1">Checking availability...</p>}
                            {!licenseAvailable && <p className="text-xs text-red-600 mt-1">This E-License is already registered.</p>}
                            {licenseAvailable && eLicense && !checkingLicense && <p className="text-xs text-green-600 mt-1">License available</p>}
                        </div>
                        {step1Complete && <span className="text-green-600 dark:text-green-400 text-xl">✓</span>}
                    </div>
                </div>

                {/* Step 4: Strava (OPTIONAL) */}
                <div className={`p-4 border rounded-lg transition-colors ${step3Complete ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800' : 'bg-card border-border'}`}>
                    <div className="flex items-start gap-3">
                        <div className={`mt-1 w-6 h-6 rounded-full flex items-center justify-center text-xs text-white font-bold ${step3Complete ? 'bg-green-500' : 'bg-muted-foreground'}`}>
                            5
                        </div>
                        <div className="flex-1">
                            <div className="flex justify-between items-center mb-1">
                                <label className="block font-semibold text-card-foreground">Connect Strava (Optional)</label>
                                {!stravaConnected && <span className="text-xs bg-secondary text-secondary-foreground px-2 py-1 rounded-full">Optional</span>}
                            </div>
                            <p className="text-sm text-muted-foreground mb-2">Link your account to track activities.</p>
                            <StravaAttribution className="mb-3" />

                            {stravaConnected ? (
                                <button
                                    onClick={handleDisconnectStrava}
                                    className="h-12 px-4 rounded-md border border-border bg-background text-foreground text-sm font-medium hover:bg-muted transition"
                                >
                                    Disconnect Strava
                                </button>
                            ) : (
                                <button
                                    onClick={handleConnectStrava}
                                    disabled={!eLicense} // Relaxed dependency on verified license for strava connection flow
                                    className={`inline-flex items-center transition ${eLicense ? 'hover:opacity-90' : 'opacity-50 cursor-not-allowed'}`}
                                    aria-label="Connect with Strava"
                                >
                                    <span className="sr-only">Connect with Strava</span>
                                    <img
                                        src="/strava/btn_strava_connect_with_orange.svg"
                                        alt="Connect with Strava"
                                        className="h-12 w-auto dark:hidden"
                                        loading="lazy"
                                    />
                                    <img
                                        src="/strava/btn_strava_connect_with_white.svg"
                                        alt="Connect with Strava"
                                        className="hidden h-12 w-auto dark:block"
                                        loading="lazy"
                                    />
                                </button>
                            )}
                        </div>
                        {step3Complete && <span className="text-green-600 dark:text-green-400 text-xl">✓</span>}
                    </div>
                </div>

                {/* Step 5: Zwift ID */}
                <div className={`p-4 border rounded-lg transition-colors ${step2Complete ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800' : 'bg-card border-border'}`}>
                    <div className="flex items-start gap-3">
                        <div className={`mt-1 w-6 h-6 rounded-full flex items-center justify-center text-xs text-white font-bold ${step2Complete ? 'bg-green-500' : 'bg-muted-foreground'}`}>
                            6
                        </div>
                        <div className="flex-1">
                            <label className="block font-semibold text-card-foreground mb-1">Zwift ID</label>
                            <p className="text-sm text-muted-foreground mb-2">Your Zwift ID is required for race results.</p>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={zwiftId}
                                    onChange={e => setZwiftId(e.target.value)}
                                    className="flex-1 p-3 border border-input rounded-lg focus:ring-2 focus:ring-ring focus:border-ring outline-none transition-all text-foreground bg-background placeholder-muted-foreground"
                                    placeholder="e.g. 123456"
                                />
                                <button
                                    onClick={verifyZwiftId}
                                    disabled={verifyingZwift || !zwiftId}
                                    className="px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 disabled:opacity-50"
                                >
                                    {verifyingZwift ? '...' : 'Verify'}
                                </button>
                            </div>

                            {zwiftName && (
                                <div className="mt-3 p-3 bg-secondary/30 rounded border border-border">
                                    <p className="text-sm mb-2">Found rider: <strong>{zwiftName}</strong></p>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={confirmZwiftIdentity}
                                            className="text-xs px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700"
                                        >
                                            Yes, that's me
                                        </button>
                                        <button
                                            onClick={() => setZwiftName('')}
                                            className="text-xs px-3 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200"
                                        >
                                            No
                                        </button>
                                    </div>
                                </div>
                            )}
                            {zwiftVerified && !zwiftName && (
                                <p className="text-xs text-green-600 mt-2">✓ Zwift ID Verified</p>
                            )}
                        </div>
                        {step2Complete && <span className="text-green-600 dark:text-green-400 text-xl">✓</span>}
                    </div>
                </div>

                {/* Step 6: Code of Conduct */}
                <div className={`p-4 border rounded-lg transition-colors ${step4Complete ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800' : 'bg-card border-border'}`}>
                    <div className="flex items-start gap-3">
                        <div className={`mt-1 w-6 h-6 rounded-full flex items-center justify-center text-xs text-white font-bold ${step4Complete ? 'bg-green-500' : 'bg-muted-foreground'}`}>
                            7
                        </div>
                        <div className="flex-1">
                            <label className="block font-semibold text-card-foreground mb-1">Code of Conduct</label>
                            <p className="text-sm text-muted-foreground mb-3">
                                Please read and agree to the <a href="https://docs.google.com/document/d/1lQE0w8ylJLoBscj6rgWZ4nGYqKbCsoin9HR4wBiF3V4/edit?usp=sharing" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">League Code of Conduct</a>.
                            </p>

                            <div className="space-y-3">
                                {!acceptedCoC ? (
                                    <button
                                        onClick={() => setShowCoCModal(true)}
                                        className="w-full py-2 px-4 bg-secondary hover:bg-secondary/80 text-secondary-foreground rounded-lg font-medium transition flex items-center justify-center gap-2"
                                    >
                                        <span>📄 Read Code of Conduct</span>
                                    </button>
                                ) : (
                                    <div className="flex items-center gap-3 p-2 bg-green-50 dark:bg-green-900/20 rounded border border-green-200 dark:border-green-800">
                                        <span className="text-green-600 dark:text-green-400 font-bold">✓ Agreed</span>
                                        <button
                                            onClick={() => setShowCoCModal(true)}
                                            className="text-xs text-muted-foreground hover:underline"
                                        >
                                            (View again)
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                        {step4Complete && <span className="text-green-600 dark:text-green-400 text-xl">✓</span>}
                    </div>
                </div>

                {/* Request Trainer Modal */}
                {showRequestTrainerModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                        <div className="bg-card w-full max-w-md rounded-lg shadow-2xl border border-border overflow-hidden">
                            <div className="p-4 border-b border-border bg-muted/30">
                                <h3 className="text-lg font-bold text-card-foreground">Request Trainer Approval</h3>
                            </div>
                            <div className="p-6">
                                <p className="text-sm text-muted-foreground mb-4">
                                    Enter the name of your trainer or powermeter. Admins will review your request and approve it if it meets the league requirements.
                                </p>
                                <input
                                    type="text"
                                    value={requestedTrainerName}
                                    onChange={e => setRequestedTrainerName(e.target.value)}
                                    placeholder="e.g., Wahoo KICKR V6"
                                    className="w-full p-3 border border-input rounded-lg focus:ring-2 focus:ring-ring focus:border-ring outline-none transition-all text-foreground bg-background placeholder-muted-foreground"
                                />
                            </div>
                            <div className="p-4 border-t border-border bg-muted/30 flex justify-end gap-3">
                                <button
                                    onClick={() => {
                                        setShowRequestTrainerModal(false);
                                        setRequestedTrainerName('');
                                    }}
                                    disabled={submittingTrainerRequest}
                                    className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleRequestTrainer}
                                    disabled={submittingTrainerRequest || !requestedTrainerName.trim()}
                                    className="px-6 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 font-bold shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {submittingTrainerRequest ? 'Submitting...' : 'Submit Request'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* CoC Modal */}
                {showCoCModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                        <div className="bg-card w-full max-w-4xl h-[80vh] flex flex-col rounded-lg shadow-2xl border border-border overflow-hidden">
                            <div className="p-4 border-b border-border flex justify-between items-center bg-muted/30">
                                <h3 className="text-lg font-bold text-card-foreground">League Code of Conduct</h3>
                                <button
                                    onClick={() => setShowCoCModal(false)}
                                    className="text-muted-foreground hover:text-foreground p-1"
                                >
                                    ✕
                                </button>
                            </div>
                            <div className="flex-1 bg-white">
                                <iframe
                                    src="https://docs.google.com/document/d/1lQE0w8ylJLoBscj6rgWZ4nGYqKbCsoin9HR4wBiF3V4/preview"
                                    className="w-full h-full border-0"
                                    title="Code of Conduct"
                                />
                            </div>
                            <div className="p-4 border-t border-border bg-muted/30 flex justify-end gap-3">
                                <button
                                    onClick={() => setShowCoCModal(false)}
                                    className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => {
                                        setAcceptedCoC(true);
                                        setShowCoCModal(false);
                                    }}
                                    className="px-6 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 font-bold shadow-sm"
                                >
                                    I Agree
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Submit Buttons */}
                <div className="pt-4 space-y-3">
                    {/* Save Progress Button */}
                    {!isRegistered && (
                        <button
                            onClick={handleSaveProgress}
                            disabled={savingProgress || submitting || !name}
                            className={`w-full py-3 rounded-lg font-medium text-base transition shadow-sm
                        ${name && !savingProgress && !submitting
                                    ? 'bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border'
                                    : 'bg-secondary/50 text-muted-foreground cursor-not-allowed border border-border'}`}
                        >
                            {savingProgress ? 'Saving...' : '💾 Save Progress'}
                        </button>
                    )}

                    {/* Complete Registration Button */}
                    <button
                        onClick={handleSubmit}
                        disabled={!canSubmit || submitting || savingProgress}
                        className={`w-full py-3 rounded-lg font-bold text-lg transition shadow-md
                    ${canSubmit && !savingProgress
                                ? 'bg-primary text-primary-foreground hover:opacity-90 hover:shadow-lg transform hover:-translate-y-0.5'
                                : 'bg-secondary text-muted-foreground cursor-not-allowed'}`}
                    >
                        {submitting
                            ? 'Saving...'
                            : (isRegistered ? 'Update Profile' : 'Complete Registration')}
                    </button>

                    {isRegistered && !canSubmit && missingRequirements.length > 0 && (
                        <div className="text-sm text-muted-foreground border border-border rounded-lg p-3 bg-muted/20">
                            <div className="font-medium text-card-foreground mb-1">Update disabled — missing:</div>
                            <ul className="list-disc pl-5 space-y-1">
                                {missingRequirements.map(req => (
                                    <li key={req}>{req}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                    
                    {!canSubmit && !isRegistered && (
                        <p className="text-center text-sm text-muted-foreground">
                            {name 
                                ? 'Complete all required steps to finish registration, or save your progress to continue later.'
                                : 'Enter your name to save progress or complete all steps to finish registration.'}
                        </p>
                    )}
                </div>

            </div>
        </div>
    );
}

export default function RegisterPage() {
    return (
        <Suspense fallback={<div className="p-8 text-center">Loading...</div>}>
            <RegisterContent />
        </Suspense>
    );
}
