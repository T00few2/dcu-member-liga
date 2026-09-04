import { describe, it, expect } from 'vitest';
import {
  raceHasEventId,
  getSignupRaceOptions,
  filterRidersBySignupIds,
} from '@/lib/raceSignupOptions';
import type { Race } from '@/types/live';

function race(partial: Partial<Race> & Pick<Race, 'id' | 'name'>): Race {
  return {
    date: '2026-09-01T10:00:00Z',
    ...partial,
  } as Race;
}

describe('raceHasEventId', () => {
  it('is true when the race has an eventId', () => {
    expect(raceHasEventId(race({ id: '1', name: 'A', eventId: 'e1' }))).toBe(true);
  });

  it('is true when a subgroup or race group has an eventId', () => {
    expect(raceHasEventId(race({
      id: '1',
      name: 'A',
      eventConfiguration: [{ eventId: 'e2', customCategory: 'A' }],
    }))).toBe(true);
    expect(raceHasEventId(race({
      id: '1',
      name: 'A',
      raceGroups: [{ eventId: 'e3', categories: [] }],
    }))).toBe(true);
  });

  it('is false when no event ids are present', () => {
    expect(raceHasEventId(race({ id: '1', name: 'A' }))).toBe(false);
  });
});

describe('getSignupRaceOptions', () => {
  const now = Date.parse('2026-09-04T08:00:00Z');

  it('includes preregister races and races with Zwift events', () => {
    const options = getSignupRaceOptions([
      race({ id: 'past-prereg', name: 'Past prereg', date: '2026-09-01T10:00:00Z', preRegisterAllowed: true }),
      race({ id: 'future-event', name: 'Future event', date: '2026-09-10T10:00:00Z', eventId: 'e1' }),
      race({ id: 'hidden', name: 'Hidden', date: '2026-09-12T10:00:00Z' }),
    ], now);

    expect(options.map(r => r.id)).toEqual(['future-event', 'past-prereg']);
  });

  it('sorts upcoming races first, then chronological', () => {
    const options = getSignupRaceOptions([
      race({ id: 'later', name: 'Later', date: '2026-09-20T10:00:00Z', preRegisterAllowed: true }),
      race({ id: 'soon', name: 'Soon', date: '2026-09-05T10:00:00Z', preRegisterAllowed: true }),
      race({ id: 'old', name: 'Old', date: '2026-08-01T10:00:00Z', preRegisterAllowed: true }),
    ], now);

    expect(options.map(r => r.id)).toEqual(['soon', 'later', 'old']);
  });
});

describe('filterRidersBySignupIds', () => {
  it('returns all riders when no signup set is provided', () => {
    const riders = [{ zwiftId: '1' }, { zwiftId: '2' }];
    expect(filterRidersBySignupIds(riders, null)).toEqual(riders);
  });

  it('keeps only riders whose zwiftId is in the signup set', () => {
    const riders = [{ zwiftId: '1' }, { zwiftId: '2' }, { zwiftId: null }, { name: 'x' }];
    expect(filterRidersBySignupIds(riders, new Set(['2', '9']))).toEqual([{ zwiftId: '2' }]);
  });
});
