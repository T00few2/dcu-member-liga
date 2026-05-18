'use client';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtGap(sec: number, frac: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    const time = m > 0 ? (s > 0 ? `${m}m ${s}s` : `${m}m`) : `${s}s`;
    return `${time} (${(frac * 100).toFixed(1)}%)`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StreamStatusBadgesProps {
    hasZwift: boolean;
    hasStrava: boolean;
    showGapOverlay: boolean;
    showEndGapOverlay: boolean;
    gapSec: number;
    gapFraction: number;
    endGapSec: number;
    endGapFraction: number;
    totalCropFraction: number;
    cropExceedsLimit: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function StreamStatusBadges({
    hasZwift,
    hasStrava,
    showGapOverlay,
    showEndGapOverlay,
    gapSec,
    gapFraction,
    endGapSec,
    endGapFraction,
    totalCropFraction,
    cropExceedsLimit,
}: StreamStatusBadgesProps) {
    return (
        <>
            {!hasZwift && hasStrava && (
                <p className="text-xs text-amber-700 mb-2 px-1">
                    Zwift stream data is unavailable for this comparison; showing Strava stream only.
                </p>
            )}

            {(showGapOverlay || showEndGapOverlay) && cropExceedsLimit && (
                <p className="text-xs text-amber-700 mb-2 px-1">
                    {showGapOverlay && <>Strava starts late: {fmtGap(gapSec, gapFraction)}. </>}
                    {showEndGapOverlay && <>Strava stops early: {fmtGap(endGapSec, endGapFraction)}. </>}
                    Total crop {fmtGap(gapSec + endGapSec, totalCropFraction)} exceeds the 15% limit —
                    Zwift stream was not cropped. Peak watt comparison may be distorted.
                </p>
            )}
            {showGapOverlay && !cropExceedsLimit && (
                <p className="text-xs text-blue-700 mb-1 px-1">
                    Strava starts late: {fmtGap(gapSec, gapFraction)} — Zwift start cropped to match.
                </p>
            )}
            {showEndGapOverlay && !cropExceedsLimit && (
                <p className="text-xs text-blue-700 mb-1 px-1">
                    Strava stops early: {fmtGap(endGapSec, endGapFraction)} — Zwift end cropped to match.
                </p>
            )}
            {showGapOverlay && showEndGapOverlay && !cropExceedsLimit && (
                <p className="text-xs text-blue-700 mb-2 px-1">
                    Total crop: {fmtGap(gapSec + endGapSec, totalCropFraction)}.
                </p>
            )}
            {hasZwift && hasStrava && !showGapOverlay && !showEndGapOverlay && (
                <p className="text-xs text-green-700 mb-2 px-1">
                    No Strava recording gap detected — both streams start and end at the same point.
                </p>
            )}
        </>
    );
}
