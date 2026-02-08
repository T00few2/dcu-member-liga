'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import Link from 'next/link';

export default function WeightVerificationModal() {
    const { user, weightVerificationStatus, refreshProfile, loading } = useAuth();
    const [isOpen, setIsOpen] = useState(false);
    const [linkInput, setLinkInput] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    // Check if we should show the modal
    useEffect(() => {
        if (loading) return;

        // Show if status is pending or rejected
        const shouldShow = user && (weightVerificationStatus === 'pending' || weightVerificationStatus === 'rejected');

        if (shouldShow) {
            // Check if dismissed for this session
            const dismissed = sessionStorage.getItem('weightVerificationDismissed');
            if (!dismissed) {
                setIsOpen(true);
            }
        } else {
            setIsOpen(false);
        }
    }, [user, weightVerificationStatus, loading]);

    const handleDismiss = () => {
        setIsOpen(false);
        sessionStorage.setItem('weightVerificationDismissed', 'true');
    };

    const handleSubmit = async () => {
        if (!user || !linkInput) return;

        if (!linkInput.startsWith('http')) {
            setError('Please enter a valid URL (starting with http:// or https://)');
            return;
        }

        setSubmitting(true);
        setError('');

        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
            const idToken = await user.getIdToken();

            const res = await fetch(`${apiUrl}/verification/submit`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify({ videoLink: linkInput })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to submit verification');

            setSuccess('Verification submitted successfully!');

            // Refresh profile to update status context
            await refreshProfile();

            // Close modal after short delay
            setTimeout(() => {
                setIsOpen(false);
            }, 2000);

        } catch (e: any) {
            setError(e.message);
        } finally {
            setSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow-xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200 dark:border-slate-700">

                {/* Header */}
                <div className={`p-4 border-b ${weightVerificationStatus === 'rejected' ? 'bg-red-50 border-red-100 dark:bg-red-900/20 dark:border-red-900' : 'bg-orange-50 border-orange-100 dark:bg-orange-900/20 dark:border-orange-900'}`}>
                    <h2 className={`text-lg font-bold flex items-center gap-2 ${weightVerificationStatus === 'rejected' ? 'text-red-700 dark:text-red-400' : 'text-orange-700 dark:text-orange-400'}`}>
                        {weightVerificationStatus === 'rejected' ? (
                            <>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                                Verification Rejected
                            </>
                        ) : (
                            <>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
                                </svg>
                                Weight Verification Required
                            </>
                        )}
                    </h2>
                </div>

                {/* Body */}
                <div className="p-6 space-y-4">
                    <p className="text-slate-600 dark:text-slate-300 text-sm">
                        {weightVerificationStatus === 'rejected'
                            ? "Your previous verification was rejected. Please review the requirements and submit a new video."
                            : "You have been selected for a random weight verification check. Please submit a video of your weigh-in to continue racing."
                        }
                    </p>

                    {!success ? (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">
                                    Video Link (YouTube/Drive/etc)
                                </label>
                                <input
                                    type="url"
                                    value={linkInput}
                                    onChange={(e) => setLinkInput(e.target.value)}
                                    placeholder="https://..."
                                    className="w-full p-2 border border-slate-300 dark:border-slate-600 rounded bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    autoFocus
                                />
                            </div>

                            {error && (
                                <div className="text-red-500 text-xs bg-red-50 dark:bg-red-900/10 p-2 rounded border border-red-100 dark:border-red-900/30">
                                    {error}
                                </div>
                            )}

                            <div className="flex gap-3 pt-2">
                                <button
                                    onClick={handleSubmit}
                                    disabled={submitting || !linkInput}
                                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded font-medium disabled:opacity-50 transition-colors"
                                >
                                    {submitting ? 'Submitting...' : 'Submit Verification'}
                                </button>
                                <button
                                    onClick={handleDismiss}
                                    className="px-4 py-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 font-medium transition-colors"
                                >
                                    Later
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-4 space-y-4">
                            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-600">
                                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                            </div>
                            <h3 className="text-lg font-medium text-slate-900 dark:text-white">
                                Submitted!
                            </h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                Thanks for verifying. An admin will review your video shortly.
                            </p>
                        </div>
                    )}
                </div>

                {/* Footer instructions link */}
                {!success && (
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-3 text-center border-t border-slate-100 dark:border-slate-800">
                        <Link href="/register" className="text-xs text-blue-600 hover:underline" onClick={() => setIsOpen(false)}>
                            View verification instructions
                        </Link>
                    </div>
                )}
            </div>
        </div>
    );
}
