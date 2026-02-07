'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';

interface VerificationRequest {
    requestId: string;
    requestedAt: any;
    status: 'pending' | 'submitted' | 'approved' | 'rejected';
    videoLink?: string;
    rejectionReason?: string;
    deadline?: any;
}

interface VerificationStatusProps {
    status: 'none' | 'pending' | 'submitted' | 'approved' | 'rejected';
    videoLink?: string;
    deadline?: any;
    requests?: VerificationRequest[];
    refreshProfile: () => void;
}

export default function VerificationStatus({ status, videoLink, deadline, requests = [], refreshProfile }: VerificationStatusProps) {
    const { user } = useAuth();
    const [linkInput, setLinkInput] = useState(videoLink || '');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const activeRequest = requests.find(r => r.status === 'pending');
    const displayStatus = status === 'none' && activeRequest ? 'pending' : status;

    const handleSubmit = async () => {
        if (!user || !linkInput) return;

        // Basic validation
        if (!linkInput.startsWith('http')) {
            setError('Please enter a valid URL (starting with http:// or https://)');
            return;
        }

        setSubmitting(true);
        setError('');
        setSuccess('');

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

            setSuccess('Verification submitted successfully! An admin will review it shortly.');
            refreshProfile();

        } catch (e: any) {
            setError(e.message);
        } finally {
            setSubmitting(false);
        }
    };

    if (status === 'none' && !activeRequest && requests.length === 0) {
        return (
            <div className="p-8 text-center bg-gray-50 dark:bg-gray-900 rounded-lg border border-border">
                <div className="text-4xl mb-4">✅</div>
                <h3 className="text-xl font-bold mb-2">No Verification Required</h3>
                <p className="text-muted-foreground">
                    You have not been selected for a weight verification check at this time.
                    Keep racing!
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-6">

            {/* Status Banner */}
            <div className={`p-6 rounded-lg border ${displayStatus === 'pending' ? 'bg-orange-50 border-orange-200 dark:bg-orange-900/20 dark:border-orange-800' :
                displayStatus === 'submitted' ? 'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800' :
                    displayStatus === 'approved' ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800' :
                        'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800'
                }`}>
                <h3 className={`text-lg font-bold mb-2 ${displayStatus === 'pending' ? 'text-orange-800 dark:text-orange-200' :
                    displayStatus === 'submitted' ? 'text-blue-800 dark:text-blue-200' :
                        displayStatus === 'approved' ? 'text-green-800 dark:text-green-200' :
                            'text-red-800 dark:text-red-200'
                    }`}>
                    Status: {displayStatus.charAt(0).toUpperCase() + displayStatus.slice(1)}
                </h3>

                {displayStatus === 'pending' && (
                    <p className="text-orange-700 dark:text-orange-300">
                        You have been selected for a random weight verification check.
                        Please record a weigh-in video and submit the link below.
                        {deadline && <span className="block font-bold mt-1">Deadline: {new Date(deadline.seconds ? deadline.seconds * 1000 : deadline).toLocaleDateString()}</span>}
                    </p>
                )}
                {displayStatus === 'submitted' && (
                    <p className="text-blue-700 dark:text-blue-300">
                        Your video has been submitted and is pending review by an admin.
                    </p>
                )}
                {displayStatus === 'approved' && (
                    <p className="text-green-700 dark:text-green-300">
                        Your weight verification has been approved. Thank you for your cooperation!
                    </p>
                )}
                {displayStatus === 'rejected' && (
                    <p className="text-red-700 dark:text-red-300">
                        Your verification was rejected. Please contact an admin or wait for a new request.
                    </p>
                )}
            </div>

            {/* Submission Form */}
            {displayStatus === 'pending' && (
                <div className="bg-card p-6 border border-border rounded-lg shadow-sm">
                    <h4 className="font-semibold mb-4 text-card-foreground">Submit Verification Video</h4>

                    <div className="mb-4 text-sm text-muted-foreground space-y-2">
                        <p><strong>Instructions:</strong></p>
                        <ol className="list-decimal pl-5 space-y-1">
                            <li>Record a video showing your face, you stepping on the scale, and the clear weight reading.</li>
                            <li>Upload the video to YouTube (select "Unlisted" visibility) or Google Drive/Dropbox (Share &rarr; Anyone with link).</li>
                            <li>Paste the shareable link below.</li>
                        </ol>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium mb-1">Video Link</label>
                            <input
                                type="url"
                                value={linkInput}
                                onChange={(e) => setLinkInput(e.target.value)}
                                placeholder="https://youtube.com/..."
                                className="w-full p-3 border border-input rounded bg-background text-foreground"
                            />
                        </div>

                        {error && <div className="text-red-600 text-sm">{error}</div>}
                        {success && <div className="text-green-600 text-sm">{success}</div>}

                        <button
                            onClick={handleSubmit}
                            disabled={submitting || !linkInput}
                            className="w-full py-3 bg-primary text-primary-foreground font-bold rounded hover:bg-primary/90 transition-colors disabled:opacity-50"
                        >
                            {submitting ? 'Submitting...' : 'Submit Verification'}
                        </button>
                    </div>
                </div>
            )}

            {/* History Link (optional expansion) */}
            {requests.length > 0 && (
                <div className="mt-8 pt-6 border-t border-border">
                    <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-4">History</h4>
                    <div className="space-y-2">
                        {requests.map((req, idx) => (
                            <div key={idx} className="flex justify-between items-center text-sm p-3 bg-muted/30 rounded">
                                <div>
                                    <span className={`font-medium ${req.status === 'approved' ? 'text-green-600' :
                                        req.status === 'rejected' ? 'text-red-600' : 'text-muted-foreground'
                                        }`}>
                                        {req.status.toUpperCase()}
                                    </span>
                                    <span className="text-muted-foreground mx-2">•</span>
                                    <span className="text-muted-foreground">
                                        {new Date(req.requestedAt?.seconds ? req.requestedAt.seconds * 1000 : req.requestedAt).toLocaleDateString()}
                                    </span>
                                </div>
                                {req.status === 'rejected' && req.rejectionReason && (
                                    <div className="text-red-500 text-xs italic">
                                        Reason: {req.rejectionReason}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

        </div>
    );
}
