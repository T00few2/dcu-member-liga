type FirestoreTimestamp = { seconds: number; nanoseconds?: number };
type DateInput = string | number | Date;
type TimestampInput = FirestoreTimestamp | DateInput | null | undefined;

function parseDateInput(value: DateInput): Date {
    if (value instanceof Date) return value;
    if (typeof value === 'number') return new Date(value);

    const raw = String(value).trim();
    const direct = new Date(raw);
    if (!Number.isNaN(direct.getTime())) return direct;

    // Safari does not reliably parse "YYYY-MM-DD HH:mm:ss".
    const isoLike = raw.replace(' ', 'T');
    const fixed = new Date(isoLike);
    if (!Number.isNaN(fixed.getTime())) return fixed;

    return new Date(NaN);
}

/** Resolve a Firestore timestamp object, date string, or number to a JS Date. */
export function fromTimestamp(value: TimestampInput): Date | null {
    if (!value) return null;
    if (typeof value === 'object' && !(value instanceof Date) && 'seconds' in value) {
        return new Date((value as FirestoreTimestamp).seconds * 1000);
    }
    return parseDateInput(value as DateInput);
}

/** "mandag, 3. marts 2026" */
export function formatDateLong(date: DateInput): string {
    const parsed = parseDateInput(date);
    if (Number.isNaN(parsed.getTime())) return 'Ugyldig dato';
    return parsed.toLocaleDateString(undefined, {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
}

/** "03.03.2026" (da-DK) */
export function formatDateShort(date: DateInput): string {
    const parsed = parseDateInput(date);
    if (Number.isNaN(parsed.getTime())) return 'Ugyldig dato';
    return parsed.toLocaleDateString('da-DK', {
        day: '2-digit', month: '2-digit', year: 'numeric',
    });
}

/** "14:30" */
export function formatTime(date: DateInput): string {
    const parsed = parseDateInput(date);
    if (Number.isNaN(parsed.getTime())) return '--:--';
    return parsed.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** "14:30 CET" */
export function formatTimeWithTz(date: DateInput): string {
    const parsed = parseDateInput(date);
    if (Number.isNaN(parsed.getTime())) return '--:--';
    return parsed.toLocaleTimeString(undefined, {
        hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    });
}
