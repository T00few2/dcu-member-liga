/** Must match backend AUTO_ACTIVATE_LEAD_MINUTES so polling flips with the server window. */
export const AUTO_ACTIVATE_LEAD_MS = 30 * 60 * 1000;

/** True once the upcoming race is inside the live window (start minus 30 minutes). */
export function isLiveRaceWindowDue(raceDate: Date | null, nowMs: number = Date.now()): boolean {
    if (!raceDate) return false;
    return raceDate.getTime() - AUTO_ACTIVATE_LEAD_MS <= nowMs;
}
