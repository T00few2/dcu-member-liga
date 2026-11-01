'use client';

import { useLeagueSettingsQuery } from '@/hooks/queries';
import { verificationRuleLines } from '@/lib/verificationCopy';

/** Visible on first paint. The rule comes from the league settings, not a fixed sentence. */
export default function VerificationRuleNotice() {
    const { data: settings } = useLeagueSettingsQuery();
    const lines = verificationRuleLines(settings);
    if (!lines) return null;

    return (
        <section className="mb-6 rounded-xl border border-border bg-card p-5 text-card-foreground">
            <h2 className="text-lg font-bold mb-2">Verifikation</h2>
            {lines.map((line) => (
                <p key={line} className="text-sm leading-relaxed text-muted-foreground mt-2 first:mt-0">
                    {line}
                </p>
            ))}
        </section>
    );
}
