import { describe, it, expect } from 'vitest';
import { clubKitUnlockLines, type ClubKitPayload } from '@/lib/clubKitCopy';

describe('clubKitUnlockLines', () => {
    it('shows level grant copy when the rider has reached minLevel', () => {
        const kit: ClubKitPayload = {
            jerseyName: 'Level 50',
            minLevel: 50,
            hasLevelGrant: true,
            showCode: false,
        };
        expect(clubKitUnlockLines(kit, 80)).toContain(
            'Du har denne trøje fra Zwift-level 50 (din level er 80).',
        );
    });

    it('shows working P-code copy and pinned notes', () => {
        const kit: ClubKitPayload = {
            jerseyName: 'DZR 2025',
            assignment: 'pinned',
            notes: 'DZR club kit',
            showCode: true,
            unlockCode: 'WORKS',
        };
        const lines = clubKitUnlockLines(kit, 12);
        expect(lines).toContain('DZR club kit');
        expect(lines).toContain('PC/Mac: tryk P og indtast WORKS');
    });

    it('does not present expired codes as an unlock method', () => {
        const kit: ClubKitPayload = {
            jerseyName: 'Old Code Kit',
            minLevel: 10,
            hasLevelGrant: true,
            showCode: false,
            unlockCode: null,
            codeStatus: 'expired',
        };
        const lines = clubKitUnlockLines(kit, 20);
        expect(lines.join(' ')).not.toMatch(/indtast/i);
        expect(lines.some((line) => line.includes('Zwift-level 10'))).toBe(true);
    });
});
