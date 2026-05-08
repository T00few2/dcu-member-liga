'use client';

export interface EmailRecipientControlItem {
    id: string;
    name: string;
    email: string;
}

interface EmailRecipientControlsProps {
    recipientsOpen: boolean;
    onToggleOpen: () => void;
    recipients: EmailRecipientControlItem[];
    selectedCount: number;
    selectedWithoutEmail: number;
    sendMode: 'individual' | 'group';
    onSendModeChange: (mode: 'individual' | 'group') => void;
    recipientMode: 'to' | 'cc' | 'bcc';
    onRecipientModeChange: (mode: 'to' | 'cc' | 'bcc') => void;
    manualTo: string;
    manualCc: string;
    manualBcc: string;
    manualToCount: number | string;
    manualCcCount: number | string;
    manualBccCount: number | string;
    toError: string | null;
    ccError: string | null;
    bccError: string | null;
    onManualToChange: (value: string) => void;
    onManualCcChange: (value: string) => void;
    onManualBccChange: (value: string) => void;
    sending: boolean;
}

export default function EmailRecipientControls({
    recipientsOpen,
    onToggleOpen,
    recipients,
    selectedCount,
    selectedWithoutEmail,
    sendMode,
    onSendModeChange,
    recipientMode,
    onRecipientModeChange,
    manualTo,
    manualCc,
    manualBcc,
    manualToCount,
    manualCcCount,
    manualBccCount,
    toError,
    ccError,
    bccError,
    onManualToChange,
    onManualCcChange,
    onManualBccChange,
    sending,
}: EmailRecipientControlsProps) {
    return (
        <div className="rounded-lg border border-border">
            <button
                type="button"
                onClick={onToggleOpen}
                className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium hover:bg-muted/40 transition rounded-lg"
            >
                <span>Recipients</span>
                <span className="flex items-center gap-2 text-muted-foreground font-normal">
                    <span>
                        {sendMode === 'individual' ? 'Individual' : `Group (${recipientMode.toUpperCase()})`}
                        {' · '}{selectedCount} recipient(s)
                        {manualTo.trim() ? ` · +${manualToCount} To` : ''}
                        {manualCc.trim() ? ` · +${manualCcCount} CC` : ''}
                        {manualBcc.trim() ? ` · +${manualBccCount} BCC` : ''}
                        {selectedWithoutEmail > 0 ? ` · ${selectedWithoutEmail} skipped` : ''}
                    </span>
                    <span className="text-xs">{recipientsOpen ? '▲' : '▼'}</span>
                </span>
            </button>

            {recipientsOpen && (
                <div className="border-t border-border space-y-3 p-3">
                    <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Delivery</p>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => onSendModeChange('individual')}
                                disabled={sending}
                                className={`text-left rounded-lg border px-3 py-2.5 transition ${sendMode === 'individual' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40'}`}
                            >
                                <div className="text-sm font-medium">Individual</div>
                                <div className="text-xs text-muted-foreground mt-0.5">Personal email per recipient · Best inbox delivery</div>
                            </button>
                            <button
                                type="button"
                                onClick={() => onSendModeChange('group')}
                                disabled={sending}
                                className={`text-left rounded-lg border px-3 py-2.5 transition ${sendMode === 'group' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40'}`}
                            >
                                <div className="text-sm font-medium">Group</div>
                                <div className="text-xs text-muted-foreground mt-0.5">One email to all · Choose address visibility</div>
                            </button>
                        </div>
                        {sendMode === 'group' && (
                            <div className="space-y-1.5 pt-0.5">
                                <div className="flex items-center gap-4">
                                    {(['to', 'cc', 'bcc'] as const).map(mode => (
                                        <label key={mode} className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
                                            <input
                                                type="radio"
                                                name="recipientMode"
                                                value={mode}
                                                checked={recipientMode === mode}
                                                onChange={() => onRecipientModeChange(mode)}
                                                disabled={sending}
                                                className="accent-primary"
                                            />
                                            {mode.toUpperCase()}
                                        </label>
                                    ))}
                                </div>
                                {(recipientMode === 'to' || recipientMode === 'cc') && selectedCount > 1 && (
                                    <p className="text-xs text-amber-600">All {selectedCount} recipients will see each other&apos;s addresses.</p>
                                )}
                                {recipientMode === 'bcc' && (
                                    <p className="text-xs text-muted-foreground">Recipients are hidden from each other. May land in Promotions.</p>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="rounded-md border border-border bg-muted/30">
                        <div className="px-3 py-1.5 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wide">
                            Recipients ({selectedCount})
                        </div>
                        <div className="max-h-36 overflow-y-auto">
                            {recipients.map((recipient) => (
                                <div key={recipient.id} className="px-3 py-1.5 text-sm border-b last:border-b-0 border-border">
                                    <span className="font-medium">{recipient.name || recipient.id || 'Unknown rider'}</span>
                                    <span className="ml-2 text-xs text-muted-foreground">
                                        {recipient.email?.trim() ? recipient.email : '— no email (skipped)'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide">
                            To <span className="normal-case font-normal">(optional, comma-separated)</span>
                        </label>
                        <input
                            type="text"
                            value={manualTo}
                            onChange={(e) => onManualToChange(e.target.value)}
                            disabled={sending}
                            className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
                            placeholder="to@example.com, another@example.com"
                        />
                        {toError && <p className="text-xs text-red-600">{toError}</p>}
                    </div>

                    <div className="space-y-1">
                        <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide">
                            CC <span className="normal-case font-normal">(optional, comma-separated)</span>
                        </label>
                        <input
                            type="text"
                            value={manualCc}
                            onChange={(e) => onManualCcChange(e.target.value)}
                            disabled={sending}
                            className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
                            placeholder="cc@example.com, another@example.com"
                        />
                        {ccError && <p className="text-xs text-red-600">{ccError}</p>}
                    </div>

                    <div className="space-y-1">
                        <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide">
                            BCC <span className="normal-case font-normal">(optional, comma-separated)</span>
                        </label>
                        <input
                            type="text"
                            value={manualBcc}
                            onChange={(e) => onManualBccChange(e.target.value)}
                            disabled={sending}
                            className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
                            placeholder="bcc@example.com"
                        />
                        {bccError && <p className="text-xs text-red-600">{bccError}</p>}
                    </div>
                </div>
            )}
        </div>
    );
}
