import type { LigaCategoryDef } from '@/lib/ligaCategories';
import { catLower, effectiveLigaCategories } from '@/lib/ligaCategories';
import {
    DEFAULT_SEASON_RANK_POINTS,
    SEASON_POINT_TABLE_LABELS,
    type SeasonPointTableKey,
} from '@/lib/seasonPointsDefaults';
import { isOneDaySeasonClass, tourEvents, tourGcCountingSentence } from '@/lib/seasonUi';
import type { SeasonRankPointTable, SeasonRankPoints, StageRace } from '@/types/admin';

export type LlmsLeagueSettings = {
    gracePeriod?: number;
    finishPoints?: number[];
    sprintPoints?: number[];
    leagueRankPoints?: number[];
    seasonRankPoints?: SeasonRankPoints;
    seasonBestResultsCount?: number;
    ligaCategories?: LigaCategoryDef[];
    weightVerificationValidDays?: number;
};

export type LlmsStageRace = {
    id?: string;
    name?: string;
    seasonClass?: string;
    bestRacesCount?: number;
    stages?: { id: string }[];
};

const PUBLIC_SEASON_KEYS: SeasonPointTableKey[] = ['tour_overall', 'tour_stage', 'wt_classic'];

function joinDanish(names: string[]): string {
    if (names.length === 0) return '';
    if (names.length === 1) return names[0]!;
    if (names.length === 2) return `${names[0]} og ${names[1]}`;
    return `${names.slice(0, -1).join(', ')} og ${names[names.length - 1]}`;
}

function formatPlaceList(values: number[] | undefined): string {
    const arr = values ?? [];
    let end = arr.length;
    while (end > 0 && !Number(arr[end - 1])) end -= 1;
    if (end === 0) return 'ingen skala publiceret';
    return arr.slice(0, end).map((points, index) => `${index + 1}: ${Number(points) || 0}`).join(', ');
}

function formatSeasonTable(table: SeasonRankPointTable | undefined): string {
    const byPlace = formatPlaceList(table?.byPlace);
    const ranges = (table?.ranges ?? [])
        .filter((band) => Number.isFinite(Number(band.from)) && Number.isFinite(Number(band.to)))
        .map((band) => `${band.from}–${band.to}: ${Number(band.points) || 0}`);
    if (ranges.length === 0) return byPlace;
    return `${byPlace}. Derefter ${ranges.join(', ')}`;
}

function categoryLines(cats: LigaCategoryDef[], grace: number): string[] {
    return cats.map((row, index) => {
        const lower = catLower(cats, index);
        const upper = row.upper;
        const range = upper == null ? `≥ ${lower}` : `${lower}–${Number(upper) - 1}`;
        const graceLabel = upper == null ? 'ingen øvre grace-grænse' : `grace-grænse ${Number(upper) + grace}`;
        const verification = row.requiresVerification === true ? 'verifikation kræves' : 'ingen verifikation';
        return `- ${row.name}: vELO ${range} (${graceLabel}; ${verification})`;
    });
}

export function buildLlmsTxt(input: {
    siteUrl: string;
    settings: LlmsLeagueSettings;
    stageRaces: LlmsStageRace[] | null;
}): string {
    const siteUrl = input.siteUrl.replace(/\/$/, '');
    const settings = input.settings;
    const cats = effectiveLigaCategories(settings);
    const grace = Number(settings.gracePeriod) > 0 ? Number(settings.gracePeriod) : 35;
    const verificationNames = cats
        .filter((cat) => cat.requiresVerification === true)
        .map((cat) => cat.name)
        .filter(Boolean);
    const verificationLabel = joinDanish(verificationNames);
    const weightDays = Number(settings.weightVerificationValidDays) > 0
        ? Number(settings.weightVerificationValidDays)
        : 30;

    const stageRaces = input.stageRaces ?? [];
    const tours = tourEvents(stageRaces as StageRace[]);
    const classicCount = stageRaces.filter((event) => isOneDaySeasonClass(event.seasonClass)).length;
    const seasonPoints = settings.seasonRankPoints || DEFAULT_SEASON_RANK_POINTS;
    const seasonBest = Number(settings.seasonBestResultsCount) || 0;
    const hasMonument = stageRaces.some((event) => event.seasonClass === 'monument');
    const seasonKeys: SeasonPointTableKey[] = hasMonument
        ? [...PUBLIC_SEASON_KEYS, 'monument']
        : PUBLIC_SEASON_KEYS;

    const lines: string[] = [
        '# DCU E-serien',
        '',
        '> DCU E-serien er en e-cycling liga for medlemmer af en DCU-klub. Deltagerne kører virtuelle løb på Zwift. Denne fil bygges fra ligaens aktuelle indstillinger, så den følger det ryttere ser på siden.',
        '',
        `Hjemmeside: ${siteUrl}`,
        '',
        '## Sæsonformat',
        '',
    ];

    if (input.stageRaces == null) {
        lines.push(`Sæsonens løb kunne ikke hentes. Se ${siteUrl}/schedule og ${siteUrl}/info.`);
    } else if (tours.length === 0 && classicCount === 0) {
        lines.push('Ingen tourer eller klassikere er offentliggjort endnu.');
    } else {
        const tourPhrase = tours.length > 0 ? joinDanish(tours.map((tour) => tour.name).filter(Boolean)) : '';
        const classicPhrase = classicCount === 1 ? '1 Klassiker' : `${classicCount} Klassikere`;
        if (tourPhrase && classicCount > 0) {
            lines.push(`Sæsonen består af ${tourPhrase} (etaper og samlet stilling) og ${classicPhrase}.`);
        } else if (tourPhrase) {
            lines.push(`Sæsonen består af ${tourPhrase} (etaper og samlet stilling).`);
        } else {
            lines.push(`Sæsonen består af ${classicPhrase}.`);
        }
        for (const tour of tours) {
            const sentence = tourGcCountingSentence(tour);
            if (sentence) lines.push(sentence);
        }
    }

    lines.push(
        '',
        '## Kategorier',
        '',
        'Kategorien følger max30-vELO fra ZwiftRacing. Ved tilmelding placeres rytteren automatisk. Indtil første officielle løb opdateres kategorien dagligt. Derefter er den låst for sæsonen. En rytter kan vælge en højere kategori end den automatiske, ikke en lavere.',
        `Grace-perioden er ${grace} vELO over kategoriens øvre grænse. Inden for den grænse fuldføres sæsonen i den nuværende kategori.`,
        '',
        ...categoryLines(cats, grace),
        '',
        '## Udstyr og verifikation',
        '',
    );

    if (verificationLabel) {
        lines.push(
            `Ryttere i ${verificationLabel} skal bruge en godkendt hometrainer eller dual recording med en separat wattmåler og Strava-forbindelse.`,
            `For ryttere i ${verificationLabel} kan der kræves videodokumentation af vægten. En godkendt indvejning gælder i ${weightDays} dage fra indvejningsdatoen.`,
            'Ryttere i de øvrige kategorier kan tilmelde sig dual recording og vægtvideo frivilligt.',
        );
    } else {
        lines.push(
            'Dual recording kræves i øjeblikket ikke for nogen kategorier.',
            'Vægtverifikation kræves i øjeblikket ikke for nogen kategorier.',
            'Alle ryttere kan tilmelde sig begge tjek frivilligt.',
        );
    }

    lines.push(
        '',
        '## Point',
        '',
        'I hvert løb gives point for målplacering og for FAL-spurter (først over stregen). Dagens samlede score afgør placeringen.',
        `Mål: ${formatPlaceList(settings.finishPoints)}`,
        `FAL-spurt: ${formatPlaceList(settings.sprintPoints)}`,
        `Tour-GC (etapeplacering til samlet stilling): ${formatPlaceList(settings.leagueRankPoints)}`,
        '',
        seasonBest > 0
            ? `Sæsonstillingen bruger de ${seasonBest} bedste sæsonpointlinjer.`
            : 'Alle klassikere og alle etaper tæller til Sæsonstillingen.',
        'Sæsonpoint gives for tour samlet, tour-etape og klassiker. De tæller til sæsonstillingen, ikke til tourens interne GC.',
    );

    for (const key of seasonKeys) {
        lines.push(`${SEASON_POINT_TABLE_LABELS[key]}: ${formatSeasonTable(seasonPoints[key])}`);
    }

    lines.push(
        '',
        '## Sider',
        '',
        `- ${siteUrl}/info – format, kategorier, udstyr og regler`,
        `- ${siteUrl}/point – pointskalaer`,
        `- ${siteUrl}/schedule – sæsonkalender`,
        `- ${siteUrl}/results – sæsonstilling og løbsresultater`,
        `- ${siteUrl}/participants – tilmeldte ryttere`,
        `- ${siteUrl}/historik – tidligere sæsoner`,
        `- ${siteUrl}/register – tilmelding`,
        `- ${siteUrl}/verification – vægt og dual recording`,
        `- ${siteUrl}/datapolitik – privatliv`,
        `- ${siteUrl}/offentliggoerelse – offentliggørelse`,
        '',
    );

    return `${lines.join('\n')}\n`;
}
