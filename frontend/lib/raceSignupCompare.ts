import { fromTimestamp } from '@/lib/formatDate';

/** League races are ridden on Copenhagen time, so "race day" follows that clock. */
export const RACE_TIME_ZONE = 'Europe/Copenhagen';

const DAY_MS = 86_400_000;

export type RaceSignupCurve = {
    raceId: string;
    series: { date: string; signups: number }[];
};

export type DatedRace = {
    id: string;
    name: string;
    date: string;
};

export type AlignedSignupPoint = {
    daysBefore: number;
    signups: number;
};

export type AlignedRaceSignups = {
    raceId: string;
    name: string;
    points: AlignedSignupPoint[];
};

function parseUtcDay(day: string): number | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const date = Number(match[3]);
    const utc = Date.UTC(year, month - 1, date);
    const check = new Date(utc);
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== date) {
        return null;
    }
    return utc;
}

/** Calendar day (YYYY-MM-DD) of an instant in the given timezone. */
export function calendarDayInZone(value: string, timeZone = RACE_TIME_ZONE): string | null {
    const parsed = fromTimestamp(value);
    if (!parsed || Number.isNaN(parsed.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(parsed);
    const year = parts.find(part => part.type === 'year')?.value;
    const month = parts.find(part => part.type === 'month')?.value;
    const day = parts.find(part => part.type === 'day')?.value;
    if (!year || !month || !day) return null;
    return `${year}-${month}-${day}`;
}

export function calendarToday(timeZone = RACE_TIME_ZONE, now = new Date()): string {
    return calendarDayInZone(now.toISOString(), timeZone) ?? now.toISOString().slice(0, 10);
}

export function formatDaysBeforeLabel(daysBefore: number): string {
    if (!Number.isFinite(daysBefore)) return '';
    if (daysBefore === 0) return 'Race day';
    if (daysBefore === 1) return '1 day before';
    if (daysBefore === -1) return '1 day after';
    if (daysBefore > 1) return `${daysBefore} days before`;
    return `${-daysBefore} days after`;
}

function alignCurve(
    series: { date: string; signups: number }[],
    raceDay: string,
    today: string,
): AlignedSignupPoint[] {
    const raceUtc = parseUtcDay(raceDay);
    if (raceUtc == null) return [];
    const todayUtc = parseUtcDay(today);

    const totals = new Map<number, number>();
    for (const point of series) {
        const utc = parseUtcDay(point.date);
        if (utc == null || !Number.isFinite(point.signups)) continue;
        totals.set(utc, point.signups);
    }
    if (totals.size === 0) return [];

    const signupDays = [...totals.keys()].sort((a, b) => a - b);
    const first = signupDays[0];
    const lastSignup = signupDays[signupDays.length - 1];
    // Past races run through race day. Upcoming races stop at today so the
    // line does not invent signups between now and the start.
    const horizon = todayUtc == null ? raceUtc : Math.min(raceUtc, todayUtc);
    const end = Math.max(horizon, lastSignup);

    const points: AlignedSignupPoint[] = [];
    let cumulative = 0;
    for (let day = first; day <= end; day += DAY_MS) {
        const total = totals.get(day);
        if (total != null) cumulative = total;
        points.push({
            daysBefore: Math.round((raceUtc - day) / DAY_MS),
            signups: cumulative,
        });
    }
    return points;
}

/**
 * Cumulative signup curves shifted onto "days before the race".
 * Quiet days keep the previous total. Races without a start date are left out.
 */
export function buildRaceSignupComparison(
    curves: RaceSignupCurve[],
    races: DatedRace[],
    today: string,
): AlignedRaceSignups[] {
    const racesById = new Map(races.map(race => [race.id, race]));
    const aligned: { raceId: string; raceDay: string; rawName: string; points: AlignedSignupPoint[] }[] = [];

    for (const curve of curves) {
        const race = racesById.get(curve.raceId);
        if (!race) continue;
        const raceDay = calendarDayInZone(race.date);
        if (!raceDay) continue;
        const points = alignCurve(curve.series ?? [], raceDay, today);
        if (points.length === 0) continue;
        const rawName = race.name.trim() || curve.raceId;
        aligned.push({ raceId: curve.raceId, raceDay, rawName, points });
    }

    aligned.sort((a, b) => a.raceDay.localeCompare(b.raceDay) || a.rawName.localeCompare(b.rawName) || a.raceId.localeCompare(b.raceId));

    const nameCount = new Map<string, number>();
    for (const row of aligned) nameCount.set(row.rawName, (nameCount.get(row.rawName) ?? 0) + 1);

    return aligned.map(row => ({
        raceId: row.raceId,
        name: (nameCount.get(row.rawName) ?? 0) > 1
            ? `${row.rawName} (${row.raceDay.slice(8, 10)}/${row.raceDay.slice(5, 7)})`
            : row.rawName,
        points: row.points,
    }));
}
