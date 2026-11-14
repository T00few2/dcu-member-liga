import { describe, expect, it } from 'vitest';
import { dualRecordingGuideLines, verificationRuleLines } from '@/lib/verificationCopy';

describe('verificationCopy', () => {
    it('keeps the category rule separate from the dual-recording how-to', () => {
        const rule = verificationRuleLines({
            weightVerificationValidDays: 30,
            ligaCategories: [{ name: '1. Division', requiresVerification: true }],
        });
        expect(rule?.[0]).toContain('Verifikation er obligatorisk i 1. Division');
        expect(rule?.join(' ')).not.toContain('eksperimentelt');

        const guide = dualRecordingGuideLines().join('\n');
        expect(guide).toContain('Under Verifikation vælger rytteren');
        expect(guide).toContain('Optag i browseren (eksperimentelt)');
        expect(guide).toContain('Upload en FIT-fil (eksperimentelt)');
        expect(guide).toContain('du kan stadig blive bedt om at uploade turen til Strava');
        expect(guide).toContain('48 timer før dit heat');
    });
});
