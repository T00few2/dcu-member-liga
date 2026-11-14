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
        `Ryttere i ${label} skal bruge en godkendt hometrainer eller dual recording med en separat wattmåler. De kan også blive bedt om en vægtvideo. En godkendt indvejning gælder i ${days} dage.`,
        'I de øvrige kategorier er vægtvideo og dual recording frivillige.',
    ];
}

/**
 * How dual recording works today. Used by /llms.txt (the Discord help bot) and /info.
 * Strava remains the normal method; browser recording and FIT upload are experimental.
 */
export function dualRecordingGuideLines(): string[] {
    return [
        'Dual recording sammenligner watt fra Zwift med en anden wattfil fra samme løb.',
        'Under Verifikation vælger rytteren, hvordan filen normalt leveres: Strava (standard), optagelse i browseren, eller upload af en FIT-fil.',
        'Strava: forbind Strava på profilen. Par wattmåleren til dual recording med en cykelcomputer (fx Wahoo eller Garmin) eller Strava-appen, og upload aktiviteten til Strava efter løbet. Ligaen henter derefter selv den rigtige aktivitet.',
        'Optag i browseren (eksperimentelt): fra 48 timer før dit heat viser løbskortet «Optag dual» i Chrome på Android eller en computer. Forbind wattmåler og pulsmåler, start lidt før starten, og når du er færdig, hold knappen Færdig inde i 2 sekunder og upload. Optagelsen gemmes på enheden undervejs. iPhone og iPad kan ikke forbinde wattmålere i browseren.',
        'Upload en FIT-fil (eksperimentelt): send filen fra Verifikation på rækken for det konkrete løb, ved siden af verifikationsresultatet. Samme sted bruges, hvis en optagelse eller et Strava-match mangler eller skal erstattes.',
        'Eksperimentelt: du kan stadig blive bedt om at uploade turen til Strava. En fil, rytteren har sendt (optagelse eller FIT), er den, der sammenlignes for det løb.',
        'Par hometraineren i Zwift, og lad wattmåleren være til dual recording. De fleste wattmålere tager kun én Bluetooth-forbindelse.',
        'Ryttere med godkendt hometrainer — og ryttere uden for verifikationskategorierne — kan tilmelde sig dual recording-tjek under Verifikation. Et godkendt tjek kan vises på resultater. Et underkendt tjek ses kun af rytteren og administratorer og deklassificerer ikke automatisk.',
    ];
}
