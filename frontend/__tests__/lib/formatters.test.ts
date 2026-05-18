import { describe, it, expect } from 'vitest';
import { formatTimeValue, formatDelta, shortenRiderName, parseWorldTime } from '@/lib/formatters';

describe('formatTimeValue', () => {
    it('formats milliseconds under one hour as MM:SS.cc', () => {
        // 1:23.45 → 83450 ms, rounds to 83450
        expect(formatTimeValue(83450)).toBe('01:23.45');
    });

    it('includes hours when >= 3600000 ms', () => {
        expect(formatTimeValue(3661000)).toBe('1:01:01.00');
    });

    it('rounds to nearest 10ms', () => {
        // 1005 ms rounds to 1010
        expect(formatTimeValue(1005)).toBe('00:01.01');
    });

    it('treats negative values as 0', () => {
        expect(formatTimeValue(-5000)).toBe('00:00.00');
    });

    it('formats exactly 0 ms', () => {
        expect(formatTimeValue(0)).toBe('00:00.00');
    });
});

describe('formatDelta', () => {
    it('returns "-" for null', () => {
        expect(formatDelta(null)).toBe('-');
    });

    it('returns "-" for undefined', () => {
        expect(formatDelta(undefined)).toBe('-');
    });

    it('returns value without "+" for 0', () => {
        expect(formatDelta(0)).toBe('0.00');
    });

    it('returns value without "+" for negative ms', () => {
        expect(formatDelta(-1000)).toBe('0.00');
    });

    it('prepends "+" for positive delta', () => {
        const result = formatDelta(5000);
        expect(result.startsWith('+')).toBe(true);
    });

    it('strips leading zeros from minutes', () => {
        // 5000ms = 5 seconds
        const result = formatDelta(5000);
        expect(result).toBe('+5.00');
    });
});

describe('shortenRiderName', () => {
    it('returns full name when within maxLen', () => {
        expect(shortenRiderName('Alice', 10)).toBe('Alice');
    });

    it('truncates long names with ellipsis', () => {
        // slice(0, maxLen - 3) + '...' keeps total length = maxLen
        expect(shortenRiderName('Alexander Smith', 10)).toBe('Alexand...');
    });

    it('returns empty string for falsy name', () => {
        expect(shortenRiderName('', 10)).toBe('');
    });

    it('returns full name when maxLen is 0', () => {
        expect(shortenRiderName('Alice', 0)).toBe('Alice');
    });

    it('returns full name when maxLen is negative', () => {
        expect(shortenRiderName('Alice', -1)).toBe('Alice');
    });

    it('preserves exactly maxLen characters including ellipsis', () => {
        const result = shortenRiderName('Alexander', 8);
        expect(result.length).toBe(8);
        expect(result.endsWith('...')).toBe(true);
    });
});

describe('parseWorldTime', () => {
    it('parses a numeric string', () => {
        expect(parseWorldTime('123456789')).toBe(123456789);
    });

    it('returns a number as-is', () => {
        expect(parseWorldTime(42)).toBe(42);
    });

    it('returns null for null', () => {
        expect(parseWorldTime(null)).toBeNull();
    });

    it('returns null for undefined', () => {
        expect(parseWorldTime(undefined)).toBeNull();
    });

    it('returns null for non-numeric string', () => {
        expect(parseWorldTime('abc')).toBeNull();
    });
});
