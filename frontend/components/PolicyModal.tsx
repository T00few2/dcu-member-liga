import { useEffect, useState } from 'react';
import MarkdownRenderer from '@/components/MarkdownRenderer';

interface PolicyModalProps {
    isOpen: boolean;
    onClose: () => void;
    policyEndpoint: string;
    titleOverride?: string;
    onAccept?: () => void;
    disableAccept?: boolean;
}

type PolicyDoc = {
    policyKey: string;
    version: string;
    titleDa: string;
    contentMdDa: string;
    changeSummary?: string;
    publishedAt?: number | null;
};

export default function PolicyModal({
    isOpen,
    onClose,
    policyEndpoint,
    titleOverride,
    onAccept,
    disableAccept
}: PolicyModalProps) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [policy, setPolicy] = useState<PolicyDoc | null>(null);

    // Only fetch when the modal is opened
    useEffect(() => {
        if (!isOpen) return;

        const fetchPolicy = async () => {
            try {
                setLoading(true);
                setError('');
                const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
                const res = await fetch(`${apiUrl}/policy/${policyEndpoint}/current`);
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.message || 'Kunne ikke hente politikken.');
                setPolicy(data as PolicyDoc);
            } catch (err: unknown) {
                setError(err instanceof Error ? err.message : 'Der skete en fejl.');
            } finally {
                setLoading(false);
            }
        };

        fetchPolicy();
    }, [isOpen, policyEndpoint]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            {/* Backdrop click to close */}
            <div className="absolute inset-0" onClick={onClose}></div>

            <div className="bg-card w-full max-w-4xl max-h-[90vh] rounded-xl shadow-2xl flex flex-col border border-border relative z-10 animate-in fade-in zoom-in-95 duration-200">
                <div className="p-4 sm:p-6 border-b border-border/50 bg-muted/30 flex justify-between items-center">
                    <h2 className="text-xl sm:text-2xl font-bold text-foreground truncate mr-4">
                        {titleOverride || policy?.titleDa || 'Indlæser...'}
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-2 -mr-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-full transition-colors shrink-0"
                        aria-label="Luk"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                    </button>
                </div>

                <div className="p-4 sm:p-6 overflow-y-auto w-full custom-scrollbar relative">
                    {loading ? (
                        <div className="flex justify-center items-center py-12 text-muted-foreground min-h-[40vh]">
                            Indlæser...
                        </div>
                    ) : error ? (
                        <div className="bg-red-50 text-red-700 p-4 rounded-md mb-6 border border-red-200 min-h-[40vh]">
                            {error}
                        </div>
                    ) : policy ? (
                        <div className="prose prose-slate dark:prose-invert max-w-none">
                            <p className="text-sm text-muted-foreground mt-0 mb-4 not-prose">
                                {policy.version ? `Version ${policy.version}` : ''}
                            </p>
                            <MarkdownRenderer markdown={policy.contentMdDa} />
                        </div>
                    ) : null}
                </div>

                <div className="p-4 border-t border-border/50 flex flex-col sm:flex-row justify-end items-center gap-3 bg-muted/30">
                    <div className="flex gap-3 w-full sm:w-auto">
                        <button
                            onClick={onClose}
                            className={`flex-1 sm:flex-none px-6 py-2.5 font-bold rounded-xl transition-colors ${onAccept ? 'text-muted-foreground hover:text-foreground hover:bg-muted' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`}
                        >
                            {onAccept ? 'Luk' : 'Ok, luk'}
                        </button>

                        {onAccept && (
                            <button
                                onClick={() => {
                                    if (!disableAccept) onAccept();
                                }}
                                disabled={disableAccept || loading || !!error} // Can't accept if loading/error
                                className="flex-1 sm:flex-none px-8 py-2.5 bg-primary text-primary-foreground font-bold rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Jeg accepterer
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
