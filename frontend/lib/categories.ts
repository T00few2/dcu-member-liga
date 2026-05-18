export function sortCategoriesByRank(categories: string[], rankOrder: string[]): string[] {
    const orderMap = new Map<string, number>();
    rankOrder.forEach((name, idx) => {
        const key = String(name || '').trim().toLowerCase();
        if (key && !orderMap.has(key)) orderMap.set(key, idx);
    });
    return [...categories].sort((a, b) => {
        const aKey = String(a || '').trim().toLowerCase();
        const bKey = String(b || '').trim().toLowerCase();
        const aRank = orderMap.get(aKey);
        const bRank = orderMap.get(bKey);
        if (aRank !== undefined && bRank !== undefined) return aRank - bRank;
        if (aRank !== undefined) return -1;
        if (bRank !== undefined) return 1;
        return a.localeCompare(b);
    });
}
