import { fromTimestamp } from '@/lib/formatDate';
import type { Race } from '@/types/live';

export function raceHasEventId(race: Race): boolean {
  if (race.eventId) return true;
  if ((race.eventConfiguration || []).some(c => !!c.eventId)) return true;
  if ((race.raceGroups || []).some(g => !!g.eventId)) return true;
  return false;
}

/** Races that accept signups, upcoming first then chronological. */
export function getSignupRaceOptions(races: Race[], now = Date.now()): Race[] {
  return [...races]
    .filter(r => r.preRegisterAllowed || raceHasEventId(r))
    .sort((a, b) => {
      const at = fromTimestamp(a.date)?.getTime() ?? 0;
      const bt = fromTimestamp(b.date)?.getTime() ?? 0;
      const aFuture = at > now;
      const bFuture = bt > now;
      if (aFuture !== bFuture) return aFuture ? -1 : 1;
      return at - bt;
    });
}

export function filterRidersBySignupIds<T extends { zwiftId?: string | null }>(
  riders: T[],
  signupIds: Set<string> | null,
): T[] {
  if (!signupIds) return riders;
  return riders.filter(r => r.zwiftId != null && signupIds.has(String(r.zwiftId)));
}
