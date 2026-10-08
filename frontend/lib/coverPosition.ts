export type CoverPosition = { x: number; y: number };

export const DEFAULT_COVER_POSITION: CoverPosition = { x: 50, y: 50 };

export function clampCoverPercent(value: number): number {
    if (!Number.isFinite(value)) return 50;
    return Math.min(100, Math.max(0, Math.round(value * 10) / 10));
}

export function parseCoverPercent(value: unknown): number {
    const n = typeof value === 'number' ? value : Number(value);
    return clampCoverPercent(Number.isFinite(n) ? n : 50);
}

/** CSS object-position for a news cover. Missing values stay centered. */
export function coverObjectPosition(
    position?: { x?: number | null; y?: number | null } | null,
): string {
    const x = clampCoverPercent(position?.x ?? 50);
    const y = clampCoverPercent(position?.y ?? 50);
    return `${x}% ${y}%`;
}

/**
 * Move a cover crop so the picture follows the pointer.
 * dx/dy are pointer movement in CSS pixels. A downward drag reveals the top of the photo.
 */
export function panCoverByPixels(
    start: CoverPosition,
    dx: number,
    dy: number,
    frameW: number,
    frameH: number,
    naturalW: number,
    naturalH: number,
): CoverPosition {
    if (frameW <= 0 || frameH <= 0) return start;

    if (naturalW <= 0 || naturalH <= 0) {
        return {
            x: clampCoverPercent(start.x - (dx / frameW) * 100),
            y: clampCoverPercent(start.y - (dy / frameH) * 100),
        };
    }

    const scale = Math.max(frameW / naturalW, frameH / naturalH);
    const slackX = frameW - naturalW * scale;
    const slackY = frameH - naturalH * scale;

    const nextAxis = (startPercent: number, delta: number, slack: number) => {
        if (slack >= -0.5) return startPercent;
        const offset = slack * (startPercent / 100) + delta;
        return clampCoverPercent((offset / slack) * 100);
    };

    return {
        x: nextAxis(start.x, dx, slackX),
        y: nextAxis(start.y, dy, slackY),
    };
}
