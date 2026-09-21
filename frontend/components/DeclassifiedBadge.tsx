'use client';

export function isRiderDeclassified(
    zwiftId: string | number | undefined,
    race?: { manualDeclassifications?: Array<string | number> } | null,
    rider?: { declassified?: boolean } | null,
): boolean {
    if (rider?.declassified) return true;
    const id = String(zwiftId ?? '').trim();
    if (!id) return false;
    return (race?.manualDeclassifications ?? []).some((x) => String(x) === id);
}

export default function DeclassifiedBadge({ show }: { show: boolean }) {
    if (!show) return null;
    return (
        <span
            title="Deklasseret"
            aria-label="Deklasseret"
            className="ml-1.5 inline-flex shrink-0 items-center rounded border border-amber-300/80 bg-amber-50 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-amber-800 dark:border-amber-500/40 dark:bg-amber-950/50 dark:text-amber-300"
        >
            DC
        </span>
    );
}
