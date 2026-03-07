export function formatTime(ms: number): string {
    if (!ms) return '-';
    const roundedMs = Math.round(ms / 10) * 10;
    const totalSeconds = Math.floor(roundedMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const millis = roundedMs % 1000;

    const pad = (n: number) => n.toString().padStart(2, '0');
    const padMs = (n: number) => Math.floor(n / 10).toString().padStart(2, '0');

    if (hours > 0) {
        return `${hours}:${pad(minutes)}:${pad(seconds)}.${padMs(millis)}`;
    }
    return `${pad(minutes)}:${pad(seconds)}.${padMs(millis)}`;
}

export function formatGap(ms: number): string {
    const roundedMs = Math.round(ms / 10) * 10;
    const totalSeconds = Math.floor(roundedMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const millis = roundedMs % 1000;

    const pad = (n: number) => n.toString().padStart(2, '0');
    const padMs = (n: number) => Math.floor(n / 10).toString().padStart(2, '0');

    if (minutes > 0) {
        return `${minutes}:${pad(seconds)}.${padMs(millis)}`;
    }
    return `${seconds}.${padMs(millis)}`;
}
