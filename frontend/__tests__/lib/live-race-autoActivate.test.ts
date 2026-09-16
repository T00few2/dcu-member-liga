import { describe, it, expect } from 'vitest';
import { AUTO_ACTIVATE_LEAD_MS, isLiveRaceWindowDue } from '@/lib/live-race/autoActivate';

describe('isLiveRaceWindowDue', () => {
    const start = new Date('2026-09-17T19:00:00+02:00');

    it('is false more than 30 minutes before start', () => {
        expect(isLiveRaceWindowDue(start, start.getTime() - AUTO_ACTIVATE_LEAD_MS - 1)).toBe(false);
    });

    it('is true at the 30-minute lead-in', () => {
        expect(isLiveRaceWindowDue(start, start.getTime() - AUTO_ACTIVATE_LEAD_MS)).toBe(true);
    });

    it('is true at gun time', () => {
        expect(isLiveRaceWindowDue(start, start.getTime())).toBe(true);
    });

    it('is false when there is no race date', () => {
        expect(isLiveRaceWindowDue(null)).toBe(false);
    });
});
