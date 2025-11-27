'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

export default function SignupPage() {
  const searchParams = useSearchParams();
  const stravaConnected = searchParams.get('strava') === 'connected';

  const [eLicense, setELicense] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>(
    stravaConnected ? 'success' : 'idle'
  );
  const [message, setMessage] = useState(
    stravaConnected ? 'Strava connected successfully!' : ''
  );

  // Store eLicense in localStorage to remember it after Strava redirect
  useEffect(() => {
    if (stravaConnected) {
       // In a real app, recover the user session here
    }
  }, [stravaConnected]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
      
      const res = await fetch(`${apiUrl}/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ eLicense, name }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'Something went wrong');
      }

      setStatus('success');
      setMessage(`Success! Verified as ${data.user.name}`);
      
      // Save eLicense to use for Strava linking
      localStorage.setItem('dcu_elicense', eLicense);
      
    } catch (err: any) {
      setStatus('error');
      setMessage(err.message);
    }
  };

  const handleConnectStrava = () => {
    const storedELicense = eLicense || localStorage.getItem('dcu_elicense');
    if (!storedELicense) {
      alert("Please sign up first");
      return;
    }
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
    window.location.href = `${apiUrl}/strava/login?eLicense=${storedELicense}`;
  };

  return (
    <div className="max-w-md mx-auto mt-10 p-6 bg-white rounded-lg shadow-md">
      <h1 className="text-2xl font-bold mb-6 text-slate-800">League Signup</h1>
      
      {status === 'success' ? (
        <div className="bg-green-50 text-green-700 p-4 rounded-md">
          <p className="font-medium text-lg mb-2">Registration Complete!</p>
          <p className="mb-4">{message}</p>
          
          {!stravaConnected && (
             <div className="border-t border-green-200 pt-4 mt-4">
                <p className="text-slate-700 mb-3">Now, connect your Strava account to track your stats:</p>
                <button
                  onClick={handleConnectStrava}
                  className="w-full bg-[#FC4C02] text-white font-bold py-2 px-4 rounded hover:bg-[#E34402] transition flex items-center justify-center gap-2"
                >
                  Connect with Strava
                </button>
             </div>
          )}

          {stravaConnected && (
            <div className="mt-4 p-3 bg-blue-50 text-blue-800 rounded border border-blue-100">
              ✓ Strava Account Linked
            </div>
          )}

          <button 
            onClick={() => { 
                setStatus('idle'); 
                setELicense(''); 
                setName(''); 
                window.history.replaceState(null, '', '/signup'); // Clear URL params
            }}
            className="mt-6 text-sm text-slate-500 underline hover:text-slate-700 block mx-auto"
          >
            Register another rider
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-slate-700 mb-1">
              Full Name
            </label>
            <input
              type="text"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900"
              placeholder="Enter your full name"
            />
          </div>

          <div>
            <label htmlFor="elicense" className="block text-sm font-medium text-slate-700 mb-1">
              E-License Number
            </label>
            <input
              type="text"
              id="elicense"
              value={eLicense}
              onChange={(e) => setELicense(e.target.value)}
              required
              className="w-full p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900"
              placeholder="e.g. 12345678"
            />
            <p className="text-xs text-slate-500 mt-1">
              Your DCU E-License is required for verification.
            </p>
          </div>

          {status === 'error' && (
            <div className="text-red-600 text-sm bg-red-50 p-2 rounded">
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={status === 'loading'}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 transition disabled:opacity-50"
          >
            {status === 'loading' ? 'Verifying...' : 'Sign Up'}
          </button>
        </form>
      )}
    </div>
  );
}
