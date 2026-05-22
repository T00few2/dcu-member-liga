'use client';

import type { LiveRider } from '@/types/live';

interface Props {
    open: boolean;
    onClose: () => void;
    title: string;
    riders: LiveRider[];
}

export default function GroupRidersModal({ open, onClose, title, riders }: Props) {
    if (!open) return null;

    const sorted = [...riders].sort((a, b) => {
        if (a.registered !== b.registered) return a.registered ? -1 : 1;
        return (a.name || '').localeCompare(b.name || '', 'da');
    });

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            role="dialog"
            aria-modal="true"
            onClick={onClose}
        >
            <div
                className="bg-card border border-border rounded-lg shadow-xl w-full max-w-md max-h-[70vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <h2 className="text-sm font-bold text-primary uppercase tracking-wide">{title}</h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="h-8 w-8 rounded-full border border-border text-muted-foreground hover:bg-muted"
                        aria-label="Luk"
                    >
                        ×
                    </button>
                </div>
                <div className="overflow-auto flex-1">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-card border-b border-border">
                            <tr>
                                <th className="text-left py-2 px-4 font-medium text-muted-foreground text-xs uppercase">Rytter</th>
                                <th className="text-left py-2 px-4 font-medium text-muted-foreground text-xs uppercase">Klub</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sorted.map((r) => (
                                <tr key={r.userId} className="border-b border-border/50">
                                    <td className="py-2 px-4 font-medium text-card-foreground">
                                        {r.name || `Ukendt #${r.userId.slice(0, 6)}`}
                                    </td>
                                    <td className="py-2 px-4 text-muted-foreground">{r.club || '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
