import { describe, expect, it } from 'vitest';
import {
    buildRaceSignupComparison,
    formatDaysBeforeLabel,
    signupTotalsInWindow,
    sliceSignupWindow,
} from '@/lib/raceSignupCompare';

describe('buildRaceSignupComparison', () => {
    it('lines races up on their own start and holds the total across quiet days', () => {
        const series = buildRaceSignupComparison(
            [
                {
                    raceId: 'a',
                    series: [
                        { date: '2026-09-08', signups: 2 },
                        { date: '2026-09-10', signups: 4 },
                    ],
                },
                {
                    raceId: 'b',
                    series: [{ date: '2026-09-10', signups: 1 }],
                },
            ],
            [
                { id: 'a', name: 'Race A', date: '2026-09-10T18:00:00Z' },
                { id: 'b', name: 'Race B', date: '2026-09-12T18:00:00Z' },
            ],
            '2026-09-20',
        );

        expect(series.map(row => row.name)).toEqual(['Race A', 'Race B']);
        expect(series[0].points).toEqual([
            { daysBefore: 2, signups: 2 },
            { daysBefore: 1, signups: 2 },
            { daysBefore: 0, signups: 4 },
        ]);
        expect(series[1].points).toEqual([
            { daysBefore: 2, signups: 1 },
            { daysBefore: 1, signups: 1 },
            { daysBefore: 0, signups: 1 },
        ]);
    });

    it('stops an upcoming race at today', () => {
        const series = buildRaceSignupComparison(
            [{ raceId: 'a', series: [{ date: '2026-09-07', signups: 3 }] }],
            [{ id: 'a', name: 'Upcoming', date: '2026-09-12T18:00:00Z' }],
            '2026-09-09',
        );

        expect(series[0].points).toEqual([
            { daysBefore: 5, signups: 3 },
            { daysBefore: 4, signups: 3 },
            { daysBefore: 3, signups: 3 },
        ]);
    });

    it('keeps signups that arrive after the race', () => {
        const series = buildRaceSignupComparison(
            [{
                raceId: 'a',
                series: [
                    { date: '2026-09-09', signups: 2 },
                    { date: '2026-09-11', signups: 4 },
                ],
            }],
            [{ id: 'a', name: 'Late', date: '2026-09-10T18:00:00Z' }],
            '2026-09-20',
        );

        expect(series[0].points).toEqual([
            { daysBefore: 1, signups: 2 },
            { daysBefore: 0, signups: 2 },
            { daysBefore: -1, signups: 4 },
        ]);
    });

    it('uses the Copenhagen race day and skips races with no start', () => {
        const series = buildRaceSignupComparison(
            [
                { raceId: 'night', series: [{ date: '2026-09-11', signups: 4 }] },
                { raceId: 'missing', series: [{ date: '2026-09-01', signups: 1 }] },
                { raceId: 'undated', series: [{ date: '2026-09-01', signups: 1 }] },
            ],
            [
                { id: 'night', name: 'Night', date: '2026-09-10T23:30:00Z' },
                { id: 'undated', name: 'No date', date: '' },
            ],
            '2026-09-11',
        );

        expect(series).toEqual([
            { raceId: 'night', name: 'Night', points: [{ daysBefore: 0, signups: 4 }] },
        ]);
    });

    it('adds the race day when two races share a name', () => {
        const series = buildRaceSignupComparison(
            [
                { raceId: 'a', series: [{ date: '2026-09-01', signups: 1 }] },
                { raceId: 'b', series: [{ date: '2026-09-08', signups: 2 }] },
            ],
            [
                { id: 'b', name: 'Finale', date: '2026-09-08T18:00:00Z' },
                { id: 'a', name: 'Finale', date: '2026-09-01T18:00:00Z' },
            ],
            '2026-09-08',
        );

        expect(series.map(row => row.name)).toEqual(['Finale (01/09)', 'Finale (08/09)']);
    });
});

describe('signup axis window', () => {
    const points = [
        { daysBefore: 8, signups: 2 },
        { daysBefore: 5, signups: 4 },
        { daysBefore: 0, signups: 9 },
    ];

    it('keeps the days inside the window and one point on either side so the line meets the frame', () => {
        expect(sliceSignupWindow(points, 6, 1)).toEqual([
            { daysBefore: 8, signups: 2 },
            { daysBefore: 5, signups: 4 },
            { daysBefore: 0, signups: 9 },
        ]);
        expect(sliceSignupWindow(points, 4, 1)).toEqual([]);
    });

    it('counts the total carried into the window from earlier days', () => {
        expect(signupTotalsInWindow(points, 6, 1)).toEqual([4, 2]);
        expect(signupTotalsInWindow(points, 3, 0)).toEqual([9, 4]);
    });
});

describe('formatDaysBeforeLabel', () => {
    it('names race day, the days before it, and the days after it', () => {
        expect(formatDaysBeforeLabel(0)).toBe('Race day');
        expect(formatDaysBeforeLabel(1)).toBe('1 day before');
        expect(formatDaysBeforeLabel(14)).toBe('14 days before');
        expect(formatDaysBeforeLabel(-1)).toBe('1 day after');
        expect(formatDaysBeforeLabel(-3)).toBe('3 days after');
    });
});
