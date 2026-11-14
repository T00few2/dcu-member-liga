import { describe, expect, it } from 'vitest';
import { cadenceFromCrank, parseCyclingPower, parseHeartRate } from '@/lib/dualRecording/ble';
import { DUAL_EXPERIMENTAL_DA } from '@/lib/dualRecording/copy';
import { canResume, summarizeSamples } from '@/lib/dualRecording/samples';
import { browserCanRecord, recorderWindowOpen } from '@/lib/dualRecording/window';

describe('dual recording helpers', () => {
    it('uses the Danish experimental line', () => {
        expect(DUAL_EXPERIMENTAL_DA).toBe(
            'Eksperimentelt. Du kan stadig blive bedt om at uploade turen til Strava.',
        );
    });

    it('opens the recorder from 48 hours before the slot until 6 hours after', () => {
        const start = Date.parse('2026-11-14T18:00:00Z');
        expect(recorderWindowOpen(start, start - 47 * 60 * 60 * 1000)).toBe(true);
        expect(recorderWindowOpen(start, start - 49 * 60 * 60 * 1000)).toBe(false);
        expect(recorderWindowOpen(start, start + 5 * 60 * 60 * 1000)).toBe(true);
        expect(recorderWindowOpen(start, start + 7 * 60 * 60 * 1000)).toBe(false);
    });

    it('hides the recorder when the browser cannot connect to sensors', () => {
        const requestDevice = async () => {
            throw new Error('unused');
        };
        expect(browserCanRecord({ userAgent: 'Mozilla/5.0 (iPhone)', bluetooth: { requestDevice } })).toBe(false);
        expect(browserCanRecord({ userAgent: 'Mozilla/5.0 Chrome', bluetooth: { requestDevice } })).toBe(true);
        expect(browserCanRecord({ userAgent: 'Mozilla/5.0 Chrome' })).toBe(false);
    });

    it('summarises power coverage and can resume a saved ride', () => {
        const summary = summarizeSamples([
            { t: 0, watts: 100, cadence: 80, hr: 120 },
            { t: 10_000, watts: null, cadence: 0, hr: 130 },
            { t: 20_000, watts: 200, cadence: 90, hr: 140 },
        ]);
        expect(summary.durationSec).toBe(20);
        expect(summary.avgPower).toBe(150);
        expect(summary.avgHr).toBe(130);
        expect(summary.powerCoveragePct).toBe(50);
        expect(canResume({ raceId: 'race-1', samples: [{ t: 1, watts: 1, cadence: 1, hr: 1 }], devices: {}, updatedAt: 1 }, 'race-1')).toBe(true);
        expect(canResume(null, 'race-1')).toBe(false);
    });

    it('reads watts, cadence and heart rate from Bluetooth packets', () => {
        const hr = new DataView(new Uint8Array([0x00, 142]).buffer);
        expect(parseHeartRate(hr)).toBe(142);

        const power = new DataView(new ArrayBuffer(8));
        power.setUint16(0, 0x0020, true);
        power.setInt16(2, 250, true);
        power.setUint16(4, 20, true);
        power.setUint16(6, 2048, true);
        const first = parseCyclingPower(power, null);
        expect(first.watts).toBe(250);
        expect(first.cadence).toBeNull();
        const next = new DataView(new ArrayBuffer(8));
        next.setUint16(0, 0x0020, true);
        next.setInt16(2, 260, true);
        next.setUint16(4, 22, true);
        next.setUint16(6, 4096, true);
        const second = parseCyclingPower(next, first.crank);
        expect(second.watts).toBe(260);
        expect(second.cadence).toBe(60);
        expect(cadenceFromCrank(null, 1, 1).rpm).toBeNull();
    });
});
