import { describe, it, expect } from 'vitest';
import { dualRecordingSourceCopy, isVoluntaryDualRecording } from '@/lib/drSource';

describe('drSource', () => {
    it('treats opt_in as voluntary and everything else as required', () => {
        expect(isVoluntaryDualRecording('opt_in')).toBe(true);
        expect(isVoluntaryDualRecording('mandatory')).toBe(false);
        expect(isVoluntaryDualRecording(undefined)).toBe(false);
        expect(dualRecordingSourceCopy('opt_in').short).toBe('Frivillig');
        expect(dualRecordingSourceCopy('mandatory').short).toBe('Påkrævet');
        expect(dualRecordingSourceCopy(undefined).short).toBe('Påkrævet');
    });
});
