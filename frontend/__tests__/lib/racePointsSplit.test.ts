import { describe, expect, it } from 'vitest';
import { getSprintSegmentCountForPoints, segmentModeForDisplay } from '@/lib/racePointsSplit';

const stage1 = {
    type: 'time-trial',
    segmentType: 'split' as const,
    eventMode: 'grouped',
    sprints: [],
    selectedSegments: [],
    raceGroups: [
        {
            name: 'Division 1-3',
            segmentType: 'split' as const,
            sprints: [
                { key: '5338791988_1', name: 'SPRINT' },
                { key: '13937662126_1', name: 'BROAD ST.' },
                { key: '9651348518_1', name: 'KOM' },
                { key: '18242440738_1', name: '23RD ST.' },
            ],
            categories: [{ category: 'A' }],
        },
    ],
};

describe('segmentModeForDisplay', () => {
    it('treats a grouped time trial as splits, including the public first group', () => {
        expect(segmentModeForDisplay(stage1, 'A')).toBe('split');
        expect(segmentModeForDisplay(stage1)).toBe('split');
        expect(getSprintSegmentCountForPoints(stage1)).toBe(0);
    });

    it('keeps a points race on the points labels', () => {
        expect(segmentModeForDisplay({
            segmentType: 'sprint',
            eventMode: 'grouped',
            raceGroups: [{ segmentType: 'sprint', sprints: [{ key: '1_1' }] }],
        })).toBe('sprint');
    });
});
