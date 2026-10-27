import { describe, expect, it } from 'vitest';
import { buildLlmsTxt, type LlmsLeagueSettings, type LlmsStageRace } from '@/lib/llmsTxt';

const settings: LlmsLeagueSettings = {
    gracePeriod: 35,
    finishPoints: [50, 40, 30],
    sprintPoints: [10, 6, 2],
    leagueRankPoints: [25, 20, 15],
    seasonBestResultsCount: 0,
    weightVerificationValidDays: 30,
    ligaCategories: [
        { name: '1. Division', upper: null, requiresVerification: true },
        { name: '2. Division', upper: 2200, requiresVerification: false },
        { name: '3. Division', upper: 1900, requiresVerification: false },
    ],
};

const stageRaces: LlmsStageRace[] = [
    { id: 'tour', name: 'Forårstouren', seasonClass: 'tour', bestRacesCount: 4, stages: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }] },
    { id: 'c1', name: 'Klassiker 1', seasonClass: 'wt_classic' },
    { id: 'c2', name: 'Klassiker 2', seasonClass: 'wt_classic' },
];

describe('buildLlmsTxt', () => {
    it('describes live categories and dual recording instead of a fixed A–D league', () => {
        const text = buildLlmsTxt({
            siteUrl: 'https://www.dansk-ecykling.dk',
            settings,
            stageRaces,
        });

        expect(text).toContain('1. Division: vELO ≥ 2200');
        expect(text).toContain('verifikation kræves');
        expect(text).toContain('Ryttere i 1. Division skal bruge en godkendt hometrainer eller dual recording');
        expect(text).not.toContain('ikke for nogen kategorier');
        expect(text).not.toContain('A, B, C, D');
        expect(text).not.toContain('Zwift Racing Score');
        expect(text).not.toContain('forårsperioden');
    });

    it('states that dual recording is not required only when no category flags it', () => {
        const text = buildLlmsTxt({
            siteUrl: 'https://www.dansk-ecykling.dk',
            settings: {
                ...settings,
                ligaCategories: settings.ligaCategories?.map((cat) => ({ ...cat, requiresVerification: false })),
            },
            stageRaces,
        });

        expect(text).toContain('Dual recording kræves i øjeblikket ikke for nogen kategorier.');
    });

    it('uses the published season, including when every result counts', () => {
        const text = buildLlmsTxt({
            siteUrl: 'https://www.dansk-ecykling.dk/',
            settings,
            stageRaces,
        });

        expect(text).toContain('Forårstouren (etaper og samlet stilling) og 2 Klassikere');
        expect(text).toContain('Forårstouren: De bedste 4 af 5 etaper tæller til Tour-GC.');
        expect(text).toContain('Alle klassikere og alle etaper tæller til Sæsonstillingen.');
        expect(text).toContain('Mål: 1: 50, 2: 40, 3: 30');
        expect(text).not.toContain('5 bedste');
    });

    it('names a best-N season limit when one is configured', () => {
        const text = buildLlmsTxt({
            siteUrl: 'https://www.dansk-ecykling.dk',
            settings: { ...settings, seasonBestResultsCount: 3 },
            stageRaces,
        });

        expect(text).toContain('Sæsonstillingen bruger de 3 bedste sæsonpointlinjer.');
    });
});
