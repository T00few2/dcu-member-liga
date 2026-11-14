import { fromTimestamp } from '@/lib/formatDate';
import { bleNavigator, type BleNavigator } from '@/lib/dualRecording/webBluetooth';

const HOUR = 60 * 60 * 1000;

export function slotStartMs(
    race: {
        date: string;
        eventConfiguration?: { customCategory?: string; startTime?: string }[];
    },
    category?: string | null,
): number | null {
    const wanted = (category || '').trim().toLowerCase();
    const match = (race.eventConfiguration || []).find((row) => {
        const name = (row.customCategory || '').trim().toLowerCase();
        return Boolean(wanted) && name === wanted && row.startTime;
    });
    const parsed = fromTimestamp(match?.startTime || race.date);
    return parsed ? parsed.getTime() : null;
}

/** The live recorder can be opened from 48 hours before the slot until 6 hours after. */
export function recorderWindowOpen(startMs: number, now = Date.now()): boolean {
    return now >= startMs - 48 * HOUR && now <= startMs + 6 * HOUR;
}

export function browserCanRecord(nav?: BleNavigator): boolean {
    const current = nav ?? bleNavigator();
    if (!current) return false;
    if (/iPad|iPhone|iPod/i.test(current.userAgent || '')) return false;
    return typeof current.bluetooth?.requestDevice === 'function';
}
