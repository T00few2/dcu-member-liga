export type JerseyCodeStatus = 'working' | 'expired' | 'unverified';

export interface ClubKitPayload {
    club?: string | null;
    jerseySignature?: number | null;
    jerseyName: string;
    imageName?: string | null;
    imageUrl?: string | null;
    assignment?: 'pinned' | 'auto' | string;
    source?: 'level' | 'code' | 'both' | 'club' | string;
    minLevel?: number | null;
    unlockCode?: string | null;
    codeStatus?: JerseyCodeStatus | null;
    notes?: string | null;
    dropLevel?: number | null;
    hasLevelGrant?: boolean;
    showCode?: boolean;
    codeBlocked?: boolean;
    canEnterUnlockCode?: boolean;
}

export function clubKitUnlockLines(kit: ClubKitPayload, dropLevel?: number | null): string[] {
    const lines: string[] = [];
    const level = dropLevel ?? kit.dropLevel ?? null;
    const minLevel = kit.minLevel ?? null;
    const notes = (kit.notes || '').trim();

    if (notes) {
        lines.push(notes);
    }

    if (kit.hasLevelGrant && minLevel != null && level != null) {
        lines.push(`Du har denne trøje fra Zwift-level ${minLevel} (din level er ${level}).`);
    } else if (minLevel != null && !kit.hasLevelGrant) {
        if (level != null) {
            lines.push(`Trøjen låses op automatisk ved Zwift-level ${minLevel} (din level er ${level}).`);
        } else {
            lines.push(`Trøjen låses op automatisk ved Zwift-level ${minLevel}.`);
        }
    }

    if (kit.showCode && kit.unlockCode) {
        lines.push(`PC/Mac: tryk P og indtast ${kit.unlockCode}`);
    } else if (kit.codeBlocked) {
        lines.push(
            'Unlock-koden kan kun indtastes på PC eller Mac. Vi viser den ikke, fordi din sidste Zwift-klient ikke er PC/Mac.',
        );
    }

    if (kit.assignment === 'pinned' && lines.length === 0) {
        lines.push('Klubbens faste in-game trøje.');
    }

    return lines;
}
