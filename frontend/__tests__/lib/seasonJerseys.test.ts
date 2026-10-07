import { describe, expect, it } from 'vitest';
import { assignSeasonJerseys, wornSeasonJerseyForRider, type SeasonJerseyRider } from '@/lib/seasonJerseys';

function rider(
    zwiftId: string,
    total: number,
    sprint = 0,
    kom = 0,
): SeasonJerseyRider {
    return {
        zwiftId,
        totalPoints: total,
        sprintPoints: sprint,
        komPoints: kom,
        sprintResults: sprint > 0 ? [{ raceId: 'last', points: sprint, lastBannerPoints: sprint }] : [],
        komResults: kom > 0 ? [{ raceId: 'last', points: kom, lastBannerPoints: kom }] : [],
    };
}

function role(id: string, map: ReturnType<typeof assignSeasonJerseys>) {
    return map.get(id);
}

describe('assignSeasonJerseys', () => {
    it('gives the leader jersey to every rider tied for the division lead', () => {
        const marks = assignSeasonJerseys(
            [rider('A', 40), rider('B', 40), rider('C', 30)],
            'last',
        );
        expect(role('A', marks)?.individual).toBe('wear');
        expect(role('B', marks)?.individual).toBe('wear');
        expect(role('C', marks)?.individual).toBeUndefined();
    });

    it('passes KOM to the next rider when the leader already wears the leader jersey', () => {
        const marks = assignSeasonJerseys(
            [
                rider('Leader', 40, 0, 10),
                rider('NextKom', 30, 0, 8),
                rider('Rest', 20, 0, 2),
            ],
            'last',
        );
        expect(role('Leader', marks)).toMatchObject({ individual: 'wear', kom: 'ghost' });
        expect(role('NextKom', marks)?.kom).toBe('wear');
        expect(role('NextKom', marks)?.individual).toBeUndefined();
        expect(role('Rest', marks)?.kom).toBeUndefined();
    });

    it('passes sprint past a rider who is already wearing KOM', () => {
        const marks = assignSeasonJerseys(
            [
                rider('Leader', 40, 10, 10),
                rider('NextKom', 30, 8, 8),
                rider('NextSprint', 20, 6, 1),
            ],
            'last',
        );
        expect(role('Leader', marks)).toMatchObject({
            individual: 'wear',
            kom: 'ghost',
            sprint: 'ghost',
        });
        expect(role('NextKom', marks)?.kom).toBe('wear');
        expect(role('NextKom', marks)?.sprint).toBeUndefined();
        expect(role('NextSprint', marks)?.sprint).toBe('wear');
    });

    it('lets tied classification leaders share the jersey when neither wears a higher one', () => {
        const marks = assignSeasonJerseys(
            [
                rider('A', 40, 8, 0),
                rider('B', 30, 8, 0),
                rider('C', 20, 1, 0),
            ],
            'last',
            { individual: false, kom: false, sprint: true },
        );
        expect(role('A', marks)?.sprint).toBe('wear');
        expect(role('B', marks)?.sprint).toBe('wear');
        expect(role('C', marks)?.sprint).toBeUndefined();
    });

    it('keeps a tied classification partner in the jersey when the other wears a higher one', () => {
        const marks = assignSeasonJerseys(
            [
                rider('Leader', 40, 8, 0),
                rider('TiedSprint', 30, 8, 0),
            ],
            'last',
        );
        expect(role('Leader', marks)?.sprint).toBe('ghost');
        expect(role('TiedSprint', marks)?.sprint).toBe('wear');
    });

    it('does not let a missing KOM jersey block the sprint jersey', () => {
        const marks = assignSeasonJerseys(
            [rider('Leader', 40, 10, 10), rider('Next', 30, 4, 4)],
            'last',
            { individual: true, kom: false, sprint: true },
        );
        expect(role('Leader', marks)?.kom).toBeUndefined();
        expect(role('Leader', marks)?.sprint).toBe('ghost');
        expect(role('Next', marks)?.sprint).toBe('wear');
    });

    it('uses the last-race tiebreak before passing a jersey down', () => {
        const leader = rider('BetterLastRace', 40, 10, 0);
        const other = rider('WorseLastRace', 30, 10, 0);
        leader.sprintResults = [{ raceId: 'last', points: 6, lastBannerPoints: 1 }];
        other.sprintResults = [{ raceId: 'last', points: 4, lastBannerPoints: 4 }];
        const marks = assignSeasonJerseys([leader, other], 'last', {
            individual: false,
            kom: false,
            sprint: true,
        });
        expect(role('BetterLastRace', marks)?.sprint).toBe('wear');
        expect(role('WorseLastRace', marks)?.sprint).toBeUndefined();
    });
});

describe('wornSeasonJerseyForRider', () => {
    const catalog = {
        individual: { jerseyName: 'Førertrøje', imageUrl: 'https://cdn.example/leader.png' },
        kom: { jerseyName: 'Bjergtrøje', imageUrl: 'https://cdn.example/kom.png' },
        sprint: { jerseyName: 'Spurttrøje', imageUrl: 'https://cdn.example/sprint.png' },
    };
    const standings = {
        A: [
            rider('Leader', 40, 10, 10),
            rider('NextKom', 30, 8, 8),
            rider('NextSprint', 20, 6, 1),
        ],
    };

    it('shows the jersey the rider will race in, not a lower one they also earned', () => {
        expect(wornSeasonJerseyForRider('Leader', standings, 'last', catalog)).toMatchObject({
            slot: 'individual',
            src: catalog.individual.imageUrl,
            alt: 'Førertrøje',
            line: 'Du kører i førertrøjen.',
        });
        expect(wornSeasonJerseyForRider('NextKom', standings, 'last', catalog)?.slot).toBe('kom');
        expect(wornSeasonJerseyForRider('NextSprint', standings, 'last', catalog)?.slot).toBe('sprint');
    });

    it('matches a numeric standings id to the profile id', () => {
        const numeric = {
            A: [{ ...rider('1', 40, 0, 9), zwiftId: 9 as unknown as string }],
        };
        expect(wornSeasonJerseyForRider('9', numeric, 'last', catalog)?.slot).toBe('individual');
    });

    it('returns nothing for a rider who does not wear a jersey', () => {
        expect(wornSeasonJerseyForRider('Missing', standings, 'last', catalog)).toBeNull();
    });

    it('uses the default leader jersey when no individual image is saved', () => {
        const worn = wornSeasonJerseyForRider('Leader', standings, 'last', {
            kom: catalog.kom,
            sprint: catalog.sprint,
        });
        expect(worn?.slot).toBe('individual');
        expect(worn?.src).toContain('DanishCyclingMember2019_thumb.png');
    });
});
