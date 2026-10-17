'use client';

import { ReactNode, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

const RichTextEditor = dynamic(
    () => import('@/components/admin/RichTextEditor'),
    {
        ssr: false,
        loading: () => (
            <div className="min-h-48 border border-border rounded-lg bg-muted/10 animate-pulse" />
        ),
    }
);

interface ComposeEmailModalProps {
    isOpen: boolean;
    title: string;
    subject: string;
    onSubjectChange: (subject: string) => void;
    onMessageChange: (message: string) => void;
    initialMessage?: string;
    onClose: () => void;
    onSend: () => void;
    sending: boolean;
    sendDisabled?: boolean;
    sendLabel?: string;
    sendingLabel?: string;
    error?: string | null;
    beforeSubject?: ReactNode;
    editorPrefix?: ReactNode;
    messageLabel?: string;
    editorKey?: string | number;
    previewHtml?: string;
}

export default function ComposeEmailModal({
    isOpen,
    title,
    subject,
    onSubjectChange,
    onMessageChange,
    initialMessage = '',
    onClose,
    onSend,
    sending,
    sendDisabled = false,
    sendLabel = 'Send email',
    sendingLabel = 'Sending…',
    error,
    beforeSubject,
    editorPrefix,
    messageLabel = 'Message',
    editorKey,
    previewHtml,
}: ComposeEmailModalProps) {
    const [showPreview, setShowPreview] = useState(false);

    useEffect(() => {
        if (!isOpen) setShowPreview(false);
    }, [isOpen]);

    if (!isOpen) return null;

    const previewDocument = previewHtml
        ? previewHtml.includes('<html')
            ? previewHtml.replace('$[FNAME|]$', 'Anders')
            : `<!DOCTYPE html><html><body style="margin:0;padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#212121;">${previewHtml.replace('$[FNAME|]$', 'Anders')}</body></html>`
        : '';

    return (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50">
            <div className="flex min-h-full items-start sm:items-center justify-center p-4">
                <div className={`w-full rounded-xl border border-border bg-card p-5 shadow-xl space-y-4 my-4 ${showPreview ? 'max-w-3xl' : 'max-w-2xl'}`}>
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold">{title}</h3>
                        <button
                            onClick={onClose}
                            className="text-sm text-muted-foreground hover:text-foreground"
                            disabled={sending}
                        >
                            Close
                        </button>
                    </div>

                    {beforeSubject}

                    <div className="space-y-2">
                        <label className="block text-sm font-medium">Subject</label>
                        <input
                            type="text"
                            value={subject}
                            onChange={(e) => onSubjectChange(e.target.value)}
                            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            placeholder="Email subject"
                            maxLength={200}
                            readOnly={showPreview}
                        />
                    </div>

                    {showPreview ? (
                        <div className="space-y-2">
                            <iframe
                                title="Email preview"
                                sandbox=""
                                srcDoc={previewDocument}
                                className="h-[640px] w-full rounded-lg border border-border bg-white"
                            />
                            <p className="text-xs text-muted-foreground">Anders stands in for the rider’s first name. Each rider sees their own.</p>
                        </div>
                    ) : (
                        <>
                            {editorPrefix}

                            <div className="space-y-2">
                                <label className="block text-sm font-medium">{messageLabel}</label>
                                <RichTextEditor
                                    key={editorKey ?? (isOpen ? 'compose-open' : 'compose-closed')}
                                    onChange={onMessageChange}
                                    initialContent={initialMessage}
                                    disabled={sending}
                                />
                            </div>
                        </>
                    )}

                    {error && (
                        <p className="text-sm text-red-600">{error}</p>
                    )}

                    <div className="flex items-center justify-end gap-2">
                        {previewHtml && (
                            <button
                                type="button"
                                onClick={() => setShowPreview(open => !open)}
                                className="mr-auto text-sm border border-border rounded-lg px-3 py-1.5 hover:bg-muted/50"
                                disabled={sending}
                            >
                                {showPreview ? 'Edit' : 'Preview'}
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            className="text-sm border border-border rounded-lg px-3 py-1.5 hover:bg-muted/50"
                            disabled={sending}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={onSend}
                            className="text-sm bg-primary text-primary-foreground rounded-lg px-3 py-1.5 hover:opacity-90 disabled:opacity-60"
                            disabled={sending || sendDisabled}
                        >
                            {sending ? sendingLabel : sendLabel}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
