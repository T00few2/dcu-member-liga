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
    const { user, requestNotificationPermission } = useAuth();
    const [linkInput, setLinkInput] = useState(videoLink || '');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [permissionGranted, setPermissionGranted] = useState(typeof Notification !== 'undefined' ? Notification.permission === 'granted' : false);

    const activeRequest = requests.find(r => r.status === 'pending');
    const displayStatus = status === 'none' && activeRequest ? 'pending' : status;

    const handleSubmit = async () => {
        if (!user || !linkInput) return;

        // Basic validation
        if (!linkInput.startsWith('http')) {
            setError('Indtast venligst en gyldig URL (der starter med http:// eller https://)');
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
            if (!res.ok) throw new Error(data.message || 'Kunne ikke indsende bekræftelse');

            setSuccess('Bekræftelse indsendt med succes! En administrator vil snart gennemgå den.');
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
                <h3 className="text-xl font-bold mb-2">Ingen bekræftelse påkrævet</h3>
                <p className="text-muted-foreground">
                    Du er ikke blevet udvalgt til en vægtbekræftelse på nuværende tidspunkt.
                    Fortsæt dit løb!
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
                    Status: {displayStatus === 'pending' ? 'Afventer' : displayStatus === 'submitted' ? 'Indsendt' : displayStatus === 'approved' ? 'Godkendt' : 'Afvist'}
                </h3>

                {displayStatus === 'pending' && (
                    <p className="text-orange-700 dark:text-orange-300">
                        Du er blevet udvalgt til en stikprøve vægtbekræftelse.
                        Optag venligst en indvejningsvideo og indsend linket nedenfor.
                        {deadline && <span className="block font-bold mt-1">Frist: {new Date(deadline.seconds ? deadline.seconds * 1000 : deadline).toLocaleDateString()}</span>}
                    </p>
                )}
                {displayStatus === 'submitted' && (
                    <p className="text-blue-700 dark:text-blue-300">
                        Din video er indsendt og afventer gennemgang af en administrator.
                    </p>
                )}
                {displayStatus === 'approved' && (
                    <p className="text-green-700 dark:text-green-300">
                        Din vægtbekræftelse er blevet godkendt. Tak for dit samarbejde!
                    </p>
                )}
                {displayStatus === 'rejected' && (
                    <p className="text-red-700 dark:text-red-300">
                        Din bekræftelse blev afvist. Kontakt venligst en administrator eller afvent en ny anmodning.
                    </p>
                )}

                {/* Notification Permission Request for PWA Badge */}
                {typeof window !== 'undefined' && 'Notification' in window && !permissionGranted && (
                    <div className="mt-4 pt-4 border-t border-black/5 dark:border-white/5">
                        <p className="text-sm opacity-80 mb-2">
                            For at vise notifikationsprikken på dit hjemmeskærmsikon, skal du aktivere notifikationer.
                        </p>
                        <button
                            onClick={async () => {
                                const granted = await requestNotificationPermission();
                                if (granted) setPermissionGranted(true);
                            }}
                            className="text-xs bg-black/10 dark:bg-white/10 hover:bg-black/20 dark:hover:bg-white/20 px-3 py-1.5 rounded transition-colors"
                        >
                            Aktiver app notifikationer
                        </button>
                    </div>
                )}
                {permissionGranted && (
                    <div className="mt-4 pt-4 border-t border-black/5 dark:border-white/5 opacity-60 text-xs italic">
                        App notifikationer er aktiveret for badges på hjemmeskærmsikoner.
                    </div>
                )}
            </div>

            {/* Submission Form */}
            {displayStatus === 'pending' && (
                <div className="bg-card p-6 border border-border rounded-lg shadow-sm">
                    <h4 className="font-semibold mb-4 text-card-foreground">Indsend bekræftelsesvideo</h4>

                    <div className="mb-4 text-sm text-muted-foreground space-y-2">
                        <p><strong>Instruktioner:</strong></p>
                        <ol className="list-decimal pl-5 space-y-1">
                            <li>Optag en video, der viser dit ansigt, at du træder op på vægten, og at vægten tydeligt kan aflæses.</li>
                            <li>Upload videoen til YouTube (vælg "Skjult" som synlighed).</li>
                            <li>Indsæt et link, der kan deles, nedenfor.</li>
                        </ol>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium mb-1">Videolink</label>
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
                            {submitting ? 'Indsender...' : 'Indsend bekræftelse'}
                        </button>
                    </div>
                </div>
            )}

            {/* History Link (optional expansion) */}
            {requests.length > 0 && (
                <div className="mt-8 pt-6 border-t border-border">
                    <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-4">Historik</h4>
                    <div className="space-y-2">
                        {requests.map((req, idx) => (
                            <div key={idx} className="flex justify-between items-center text-sm p-3 bg-muted/30 rounded">
                                <div>
                                    <span className={`font-medium ${req.status === 'approved' ? 'text-green-600' :
                                        req.status === 'rejected' ? 'text-red-600' : 'text-muted-foreground'
                                        }`}>
                                        {req.status === 'pending' ? 'AFVENTER' : req.status === 'submitted' ? 'INDSENDT' : req.status === 'approved' ? 'GODKENDT' : 'AFVIST'}
                                    </span>
                                    <span className="text-muted-foreground mx-2">•</span>
                                    <span className="text-muted-foreground">
                                        {new Date(req.requestedAt?.seconds ? req.requestedAt.seconds * 1000 : req.requestedAt).toLocaleDateString()}
                                    </span>
                                </div>
                                {req.status === 'rejected' && req.rejectionReason && (
                                    <div className="text-red-500 text-xs italic">
                                        Årsag: {req.rejectionReason}
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
