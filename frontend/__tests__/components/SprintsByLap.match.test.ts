import { describe, expect, it } from 'vitest';
import {
    buildProfileSegmentIndex,
    matchSprintProfileSegment,
    sprintProfileOccurrence,
} from '@/components/races/SprintsByLap';

describe('sprintProfileOccurrence', () => {
    it('prefers count over lap', () => {
        expect(sprintProfileOccurrence({ count: 3, lap: 1 })).toBe(3);
    });

    it('falls back to lap when count missing', () => {
        expect(sprintProfileOccurrence({ count: 0, lap: 2 })).toBe(2);
    });
});

describe('matchSprintProfileSegment', () => {
    const profileSegments = [
        { name: 'Leg Snapper KOM', type: 'climb', fromKm: 4.8, toKm: 5.2, direction: 'forward' },
        { name: 'SPRINT', type: 'sprint', fromKm: 6.6, toKm: 6.9, direction: 'forward' },
        { name: 'Leg Snapper KOM', type: 'climb', fromKm: 13.8, toKm: 14.2, direction: 'forward' },
        { name: 'SPRINT', type: 'sprint', fromKm: 15.6, toKm: 15.9, direction: 'forward' },
        { name: 'Leg Snapper KOM', type: 'climb', fromKm: 22.8, toKm: 23.2, direction: 'forward' },
        { name: 'SPRINT', type: 'sprint', fromKm: 24.6, toKm: 24.9, direction: 'forward' },
    ];

    const index = buildProfileSegmentIndex(profileSegments);

    it('maps multi-pass same-lap sprints to distinct profile distances (CvC / Innsbruck)', () => {
        const sprints = [
            { name: 'Leg Snapper KOM', count: 1, lap: 1, direction: 'forward' },
            { name: 'Leg Snapper KOM', count: 2, lap: 1, direction: 'forward' },
            { name: 'Leg Snapper KOM', count: 3, lap: 1, direction: 'forward' },
            { name: 'SPRINT', count: 1, lap: 1, direction: 'forward' },
            { name: 'SPRINT', count: 2, lap: 1, direction: 'forward' },
            { name: 'SPRINT', count: 3, lap: 1, direction: 'forward' },
        ];

        const fromKms = sprints.map((s) => matchSprintProfileSegment(index, s)?.fromKm);
        expect(fromKms).toEqual([4.8, 13.8, 22.8, 6.6, 15.6, 24.6]);
    });

    it('still matches once-per-lap multi-lap sprints by count', () => {
        const tiled = [
            { name: 'Champs-Élysées', type: 'sprint', fromKm: 16, toKm: 16, direction: 'forward' },
            { name: 'Champs-Élysées', type: 'sprint', fromKm: 32, toKm: 32, direction: 'forward' },
            { name: 'Champs-Élysées', type: 'sprint', fromKm: 48, toKm: 48, direction: 'forward' },
        ];
        const champsIndex = buildProfileSegmentIndex(tiled);
        expect(
            matchSprintProfileSegment(champsIndex, {
                name: 'Champs-Élysées',
                count: 2,
                lap: 2,
                direction: 'forward',
            })?.fromKm,
        ).toBe(32);
    });
});
