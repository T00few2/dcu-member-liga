type FirestoreTimestamp = { seconds: number; nanoseconds?: number };
type DateInput = string | number | Date;
type TimestampInput = FirestoreTimestamp | DateInput | null | undefined;

/** Resolve a Firestore timestamp object, date string, or number to a JS Date. */
export function fromTimestamp(value: TimestampInput): Date | null {
    if (!value) return null;
    if (typeof value === 'object' && !(value instanceof Date) && 'seconds' in value) {
        return new Date((value as FirestoreTimestamp).seconds * 1000);
    }
    return new Date(value as DateInput);
}

/** "mandag, 3. marts 2026" */
export function formatDateLong(date: DateInput): string {
    return new Date(date).toLocaleDateString(undefined, {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
}

/** "03.03.2026" (da-DK) */
export function formatDateShort(date: DateInput): string {
    return new Date(date).toLocaleDateString('da-DK', {
        day: '2-digit', month: '2-digit', year: 'numeric',
    });
}

/** "14:30" */
export function formatTime(date: DateInput): string {
    return new Date(date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** "14:30 CET" */
export function formatTimeWithTz(date: DateInput): string {
    return new Date(date).toLocaleTimeString(undefined, {
        hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    });
}
