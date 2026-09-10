import { describe, expect, it } from 'vitest';
import { overlayRaceGroups } from '@/lib/overlayRaceGroups';

const template = [
  { id: 'high', name: 'High end', categories: [{ category: 'Diamond' }, { category: 'Ruby' }] },
  { id: 'mid', name: 'Mid', categories: [{ category: 'Emerald' }, { category: 'Platinum' }] },
  { id: 'low', name: 'Low end', categories: [{ category: 'Gold' }] },
];

describe('overlayRaceGroups', () => {
  it('keeps event ids when group names match case-insensitively', () => {
    const race = [
      { id: 'mid', name: 'mid', eventId: '222', categories: [{ category: 'Emerald', sprints: [{ id: 1 }] }] },
    ];
    const result = overlayRaceGroups(template, race);
    const mid = result.next.find((g) => g.id === 'mid');
    expect(mid?.eventId).toBe('222');
    expect(mid?.name).toBe('Mid');
  });

  it('flags dropped eventId when a renamed group does not match by id', () => {
    const race = [
      { id: 'low-old', name: 'Low end', eventId: '333', categories: [{ category: 'Gold' }] },
    ];
    const renamed = [
      template[0],
      template[1],
      { id: 'low-new', name: 'Low', categories: [{ category: 'Gold' }] },
    ];
    const result = overlayRaceGroups(renamed, race);
    expect(result.diff.droppedEventIds[0]?.eventId).toBe('333');
  });

  it('keeps category sprints when the category moves to another group', () => {
    const moved = [
      template[0],
      { id: 'mid', name: 'Mid', categories: [{ category: 'Emerald' }] },
      { id: 'low', name: 'Low end', categories: [{ category: 'Platinum' }, { category: 'Gold' }] },
    ];
    const race = [
      { id: 'mid', name: 'Mid', categories: [{ category: 'Emerald' }, { category: 'Platinum', sprints: [{ id: 9 }] }] },
      { id: 'low', name: 'Low end', eventId: '333', categories: [{ category: 'Gold' }] },
    ];
    const result = overlayRaceGroups(moved, race);
    const low = result.next.find((g) => g.name === 'Low end');
    const platinum = low?.categories?.find((c) => c.category === 'Platinum');
    expect(platinum?.sprints).toEqual([{ id: 9 }]);
  });

  it('keeps sprints when groups are renamed but leftover ids still match', () => {
    const race = [
      {
        id: 'high',
        name: 'High end',
        sprints: [{ id: 'hs' }],
        categories: [{ category: 'Division 1', sprints: [{ id: 'c1' }] }],
      },
      {
        id: 'mid',
        name: 'Mid',
        sprints: [{ id: 'ms' }],
        categories: [{ category: 'Division 4' }],
      },
      {
        id: 'low',
        name: 'Low end',
        sprints: [{ id: 'ls' }],
        categories: [{ category: 'Division 5', sprints: [{ id: 'c5' }] }],
      },
    ];
    const renamed = [
      { id: 'high', name: 'Division 1-3', categories: [{ category: 'Division 1' }, { category: 'Division 5' }] },
      { id: 'mid', name: 'Division 4-6', categories: [{ category: 'Division 4' }] },
    ];
    const result = overlayRaceGroups(renamed, race);
    const high = result.next.find((g) => g.id === 'high');
    const d5 = high?.categories?.find((c) => c.category === 'Division 5');
    expect(high?.sprints).toEqual([{ id: 'hs' }]);
    expect(d5?.sprints).toEqual([{ id: 'c5' }]);
    expect(result.diff.droppedGroupsWithSprints).toEqual(['Low end']);
  });
});
