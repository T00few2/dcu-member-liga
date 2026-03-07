// Minimum threshold distinguishing Zwift worldTime from other numeric values
export const MIN_WORLDTIME = 100000000000;

export function formatWorldTime(ms: number | null): string {
    if (ms === null || ms === undefined) return '-';
    const date = new Date(ms);
    const hours = date.getUTCHours().toString().padStart(2, '0');
    const minutes = date.getUTCMinutes().toString().padStart(2, '0');
    const seconds = date.getUTCSeconds().toString().padStart(2, '0');
    const millis = date.getUTCMilliseconds().toString().padStart(3, '0');
    return `${hours}:${minutes}:${seconds}.${millis}`;
}

export function formatElapsedTime(ms: number | null): string {
    if (ms === null || ms === undefined || ms === 0) return '-';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const millis = ms % 1000;
    return `${minutes}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

export function formatPoints(value: number | null): string {
    if (value === null || value === undefined) return '-';
    return value.toString();
}

/**
 * Parse a time string (HH:MM:SS.mmm) back to a Zwift worldTime timestamp.
 * Requires a reference timestamp from the same race to reconstruct the date portion.
 */
export function parseTimeStringToTimestamp(str: string, referenceTimestamp: number | null): number | null {
    const trimmed = str?.trim();
    if (!trimmed || trimmed === '-') return null;

    // Plain large number → use directly as timestamp
    const num = parseInt(trimmed.replace(/,/g, ''), 10);
    if (!isNaN(num) && num > MIN_WORLDTIME) return num;

    // HH:MM:SS.mmm format
    const fullMatch = trimmed.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
    if (fullMatch) {
        const hours = parseInt(fullMatch[1], 10);
        const minutes = parseInt(fullMatch[2], 10);
        const seconds = parseInt(fullMatch[3], 10);
        const millis = fullMatch[4] ? parseInt(fullMatch[4].padEnd(3, '0'), 10) : 0;

        if (referenceTimestamp && referenceTimestamp > MIN_WORLDTIME) {
            const refDate = new Date(referenceTimestamp);
            return Date.UTC(
                refDate.getUTCFullYear(), refDate.getUTCMonth(), refDate.getUTCDate(),
                hours, minutes, seconds, millis
            );
        }
        console.warn('No valid reference timestamp found.', { str: trimmed, referenceTimestamp });
        return null;
    }

    console.warn('Time string did not match expected format:', trimmed);
    return null;
}
