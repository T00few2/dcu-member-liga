import { describe, it, expect } from 'vitest';
import {
    formatWorldTime,
    formatElapsedTime,
    formatPoints,
    parseTimeStringToTimestamp,
    MIN_WORLDTIME,
} from '@/lib/timeFormat';

describe('formatWorldTime', () => {
    it('formats a known UTC timestamp correctly', () => {
        // 2021-01-01T00:00:00.000Z = 1609459200000
        const ts = Date.UTC(2021, 0, 1, 12, 34, 56, 789);
        expect(formatWorldTime(ts)).toBe('12:34:56.789');
    });

    it('pads single-digit hours, minutes, seconds', () => {
        const ts = Date.UTC(2021, 0, 1, 1, 2, 3, 4);
        expect(formatWorldTime(ts)).toBe('01:02:03.004');
    });

    it('returns "-" for null', () => {
        expect(formatWorldTime(null)).toBe('-');
    });

    it('returns "-" for undefined', () => {
        // @ts-expect-error testing runtime behaviour
        expect(formatWorldTime(undefined)).toBe('-');
    });
});

describe('formatElapsedTime', () => {
    it('formats minutes:seconds.millis', () => {
        expect(formatElapsedTime(75123)).toBe('1:15.123');
    });

    it('formats zero-padded seconds', () => {
        expect(formatElapsedTime(60000)).toBe('1:00.000');
    });

    it('returns "-" for null', () => {
        expect(formatElapsedTime(null)).toBe('-');
    });

    it('returns "-" for 0', () => {
        expect(formatElapsedTime(0)).toBe('-');
    });

    it('returns "-" for undefined', () => {
        // @ts-expect-error testing runtime behaviour
        expect(formatElapsedTime(undefined)).toBe('-');
    });
});

describe('formatPoints', () => {
    it('returns the number as a string', () => {
        expect(formatPoints(42)).toBe('42');
    });

    it('returns "-" for null', () => {
        expect(formatPoints(null)).toBe('-');
    });

    it('returns "-" for undefined', () => {
        // @ts-expect-error testing runtime behaviour
        expect(formatPoints(undefined)).toBe('-');
    });
});

describe('parseTimeStringToTimestamp', () => {
    const ref = Date.UTC(2021, 0, 1, 0, 0, 0, 0);

    it('parses HH:MM:SS format using reference timestamp', () => {
        const result = parseTimeStringToTimestamp('12:34:56', ref);
        expect(result).toBe(Date.UTC(2021, 0, 1, 12, 34, 56, 0));
    });

    it('parses HH:MM:SS.mmm format', () => {
        const result = parseTimeStringToTimestamp('01:02:03.456', ref);
        expect(result).toBe(Date.UTC(2021, 0, 1, 1, 2, 3, 456));
    });

    it('returns a large number directly when it exceeds MIN_WORLDTIME', () => {
        const largeNum = MIN_WORLDTIME + 1;
        const result = parseTimeStringToTimestamp(String(largeNum), null);
        expect(result).toBe(largeNum);
    });

    it('returns null for "-"', () => {
        expect(parseTimeStringToTimestamp('-', ref)).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(parseTimeStringToTimestamp('', ref)).toBeNull();
    });

    it('returns null when reference is missing for HH:MM:SS format', () => {
        expect(parseTimeStringToTimestamp('12:34:56', null)).toBeNull();
    });
});
