export const formatTimeValue = (ms: number): string => {
    const safeMs = Math.max(0, ms);
    const roundedMs = Math.round(safeMs / 10) * 10;
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
};

export const formatDelta = (ms?: number | null): string => {
    if (ms === null || ms === undefined) return '-';
    const raw = formatTimeValue(Math.max(0, ms));
    const stripped = raw
        .replace(/^00:/, '')
        .replace(/^0(\d):/, '$1:')
        .replace(/^0(\d)(\.)/, '$1$2');
    
    // If rounded value is effectively zero, don't show +
    if (ms <= 0 || stripped === '0.00' || stripped === '00.00') return stripped;
    return `+${stripped}`;
};

export const shortenRiderName = (name: string, maxLen: number): string => {
    if (!name) return '';
    if (!Number.isFinite(maxLen) || maxLen <= 0) {
        return name;
    }
    if (name.length <= maxLen) {
        return name;
    }
    return `${name.slice(0, Math.max(1, maxLen - 3)).trimEnd()}...`;
};

export const parseWorldTime = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    const parsed = typeof value === 'string' ? parseInt(value, 10) : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};
