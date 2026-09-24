/** Prefer the rider's current division when the same result list contains them more than once. */
export function preferredResultCategory(
    results: Record<string, { zwiftId?: string }[] | undefined> | undefined,
    zwiftId: string,
    currentCategory: string | null | undefined,
): string | null {
    if (!results || !zwiftId) return null;
    const current = String(currentCategory || '').trim();
    if (current && current !== 'N/A' && (results[current] || []).some((rider) => String(rider.zwiftId) === zwiftId)) {
        return current;
    }
    for (const [category, riders] of Object.entries(results)) {
        if ((riders || []).some((rider) => String(rider.zwiftId) === zwiftId)) return category;
    }
    return null;
}
