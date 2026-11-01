export type VerificationSettings = {
    ligaCategories?: { name?: string; requiresVerification?: boolean }[] | null;
    weightVerificationValidDays?: number;
};

export function verificationCategoryNames(settings?: VerificationSettings | null): string[] {
    return (settings?.ligaCategories ?? [])
        .filter((category) => category?.requiresVerification === true)
        .map((category) => String(category?.name ?? '').trim())
        .filter(Boolean);
}

export function joinDanish(names: string[]): string {
    if (names.length === 0) return '';
    if (names.length === 1) return names[0]!;
    if (names.length === 2) return `${names[0]} og ${names[1]}`;
    return `${names.slice(0, -1).join(', ')} og ${names[names.length - 1]}`;
}

/**
 * The verification rule in the same words on /info, /verification and /llms.txt.
 * Null when the league settings have not been loaded, so the page does not invent a rule.
 */
export function verificationRuleLines(settings?: VerificationSettings | null): string[] | null {
    if (!settings) return null;
    const names = verificationCategoryNames(settings);
    const days = Number(settings.weightVerificationValidDays) > 0
        ? Number(settings.weightVerificationValidDays)
        : 30;
    if (names.length === 0) {
        return [
            'Ingen af de aktuelle kategorier har verifikation slået til. Vægtvideo og dual recording kan stadig indsendes frivilligt.',
        ];
    }
    const label = joinDanish(names);
    return [
        `Verifikation er obligatorisk i ${label}.`,
        `Ryttere i ${label} skal bruge en godkendt hometrainer eller dual recording med en separat wattmåler og Strava-forbindelse. De kan også blive bedt om en vægtvideo. En godkendt indvejning gælder i ${days} dage.`,
        'I de øvrige kategorier er vægtvideo og dual recording frivillige.',
    ];
}
