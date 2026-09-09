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
});
