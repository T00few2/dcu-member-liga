'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

function RegisterContent() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const stravaStatusParam = searchParams.get('strava');

  // Form State
  const [eLicense, setELicense] = useState('');
  const [name, setName] = useState('');
  const [zwiftId, setZwiftId] = useState('');
  const [stravaConnected, setStravaConnected] = useState(false);

  // UI State
  const [isRegistered, setIsRegistered] = useState(false);
  const [fetchingProfile, setFetchingProfile] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/');
    }
  }, [user, authLoading, router]);

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
                setStravaConnected(data.stravaConnected || false);
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
    // We save the state momentarily to localStorage or rely on the user remembering 
    // but technically the backend needs the eLicense to link.
    // Since we haven't saved the user yet, we pass eLicense to the Strava login URL.
    // Note: This assumes the user will come back and finish the form.
    // Ideally, we should save the partial form data? 
    // For now, let's assume simple flow: User types E-License -> Connects Strava -> Returns -> Types Zwift ID -> Submits.
    
    // We need to persist the current inputs because the redirect will refresh the page
    localStorage.setItem('temp_reg_elicense', eLicense);
    localStorage.setItem('temp_reg_name', name);
    localStorage.setItem('temp_reg_zwiftid', zwiftId);

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
    window.location.href = `${apiUrl}/strava/login?eLicense=${eLicense}`;
  };

  // Restore temp state if returning from Strava
  useEffect(() => {
      if (stravaStatusParam) {
          const tempName = localStorage.getItem('temp_reg_name');
          const tempELicense = localStorage.getItem('temp_reg_elicense');
          const tempZwiftId = localStorage.getItem('temp_reg_zwiftid');
          
          if (tempName) setName(tempName);
          if (tempELicense) setELicense(tempELicense);
          if (tempZwiftId) setZwiftId(tempZwiftId);
          
          // Cleanup
          localStorage.removeItem('temp_reg_name');
          localStorage.removeItem('temp_reg_elicense');
          localStorage.removeItem('temp_reg_zwiftid');
      }
  }, [stravaStatusParam]);


  const handleSubmit = async () => {
    if (!user) return;
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
                uid: user.uid 
            }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Registration failed');

        setIsRegistered(true);
        setMessage(isRegistered ? 'Profile updated!' : 'Registration complete!');
    } catch (err: any) {
        setError(err.message);
    } finally {
        setSubmitting(false);
    }
  };

  // Validation
  const step1Complete = eLicense.length > 0; // Basic check
  const step2Complete = zwiftId.length > 0;
  const step3Complete = stravaConnected;
  
  const canSubmit = step1Complete && step2Complete && step3Complete;

  if (authLoading || fetchingProfile) {
    return <div className="p-8 text-center">Loading profile...</div>;
  }

  return (
    <div className="max-w-2xl mx-auto mt-10 p-8 bg-white rounded-lg shadow-md">
      <h1 className="text-3xl font-bold mb-2 text-slate-800">
          {isRegistered ? 'My Profile' : 'League Registration'}
      </h1>
      <p className="text-slate-600 mb-8">
          {isRegistered 
            ? 'Update your details and connections.' 
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
        <div className="p-4 border rounded-lg bg-slate-50">
            <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
            <input 
                type="text" 
                value={name} 
                onChange={e => setName(e.target.value)}
                className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="Your Name"
            />
        </div>

        {/* Step 1: E-License */}
        <div className={`p-4 border rounded-lg transition-colors ${step1Complete ? 'bg-green-50 border-green-200' : 'bg-white'}`}>
            <div className="flex items-start gap-3">
                <div className={`mt-1 w-6 h-6 rounded-full flex items-center justify-center text-xs text-white font-bold ${step1Complete ? 'bg-green-500' : 'bg-slate-400'}`}>
                    1
                </div>
                <div className="flex-1">
                    <label className="block font-semibold text-slate-800 mb-1">DCU E-License</label>
                    <p className="text-sm text-slate-500 mb-2">Enter your valid DCU E-License number.</p>
                    <input 
                        type="text" 
                        value={eLicense} 
                        onChange={e => setELicense(e.target.value)}
                        className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 outline-none"
                        placeholder="e.g. 100123456"
                    />
                </div>
                {step1Complete && <span className="text-green-600 text-xl">✓</span>}
            </div>
        </div>

        {/* Step 2: Strava (Reordered as requested: E-License -> Strava -> Zwift?) 
            Wait, user said: "e-license, zwift id and strava link should be in place before you can registrer"
            Strava needs E-license to link. So Strava MUST be after E-License.
        */}
        <div className={`p-4 border rounded-lg transition-colors ${step3Complete ? 'bg-green-50 border-green-200' : 'bg-white'}`}>
            <div className="flex items-start gap-3">
                <div className={`mt-1 w-6 h-6 rounded-full flex items-center justify-center text-xs text-white font-bold ${step3Complete ? 'bg-green-500' : 'bg-slate-400'}`}>
                    2
                </div>
                <div className="flex-1">
                    <label className="block font-semibold text-slate-800 mb-1">Connect Strava</label>
                    <p className="text-sm text-slate-500 mb-2">Link your account to track activities.</p>
                    
                    {stravaConnected ? (
                        <div className="text-green-700 font-medium flex items-center gap-2">
                            <span>Connected</span>
                            {/* Optional: Add Disconnect button in future */}
                        </div>
                    ) : (
                        <button
                            onClick={handleConnectStrava}
                            disabled={!step1Complete}
                            className={`px-4 py-2 rounded font-medium text-sm flex items-center gap-2 transition
                                ${step1Complete 
                                    ? 'bg-[#FC4C02] text-white hover:bg-[#E34402]' 
                                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
                        >
                           Connect with Strava
                        </button>
                    )}
                </div>
                {step3Complete && <span className="text-green-600 text-xl">✓</span>}
            </div>
        </div>

        {/* Step 3: Zwift ID */}
        <div className={`p-4 border rounded-lg transition-colors ${step2Complete ? 'bg-green-50 border-green-200' : 'bg-white'}`}>
            <div className="flex items-start gap-3">
                 <div className={`mt-1 w-6 h-6 rounded-full flex items-center justify-center text-xs text-white font-bold ${step2Complete ? 'bg-green-500' : 'bg-slate-400'}`}>
                    3
                </div>
                <div className="flex-1">
                    <label className="block font-semibold text-slate-800 mb-1">Zwift ID</label>
                    <p className="text-sm text-slate-500 mb-2">Your Zwift ID is required for race results.</p>
                    <input 
                        type="text" 
                        value={zwiftId} 
                        onChange={e => setZwiftId(e.target.value)}
                        className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 outline-none"
                        placeholder="e.g. 123456"
                    />
                </div>
                {step2Complete && <span className="text-green-600 text-xl">✓</span>}
            </div>
        </div>

        {/* Submit Button */}
        <div className="pt-4">
            <button
                onClick={handleSubmit}
                disabled={!canSubmit || submitting}
                className={`w-full py-3 rounded-lg font-bold text-lg transition shadow-md
                    ${canSubmit 
                        ? 'bg-blue-600 text-white hover:bg-blue-700 hover:shadow-lg transform hover:-translate-y-0.5' 
                        : 'bg-slate-300 text-slate-500 cursor-not-allowed'}`}
            >
                {submitting 
                    ? 'Saving...' 
                    : (isRegistered ? 'Update Profile' : 'Complete Registration')}
            </button>
            {!canSubmit && (
                <p className="text-center text-sm text-slate-500 mt-2">
                    Please complete all steps above to continue.
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
