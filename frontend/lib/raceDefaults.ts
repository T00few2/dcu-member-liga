import type {
    CategoryConfig,
    EventConfig,
    EventMode,
    LeagueSettings,
    RaceFormState,
    RaceGroup,
} from '@/types/admin';

/** Build race form fields from season defaults. Race save shapes stay unchanged. */
export function formFieldsFromRaceDefaults(
    settings: LeagueSettings | null | undefined,
): Pick<
    RaceFormState,
    'eventMode' | 'eventId' | 'eventSecret' | 'eventConfiguration' | 'singleModeCategories' | 'raceGroups'
> {
    const mode: EventMode = settings?.defaultEventMode || 'single';

    if (mode === 'grouped') {
        const groups: RaceGroup[] = (settings?.defaultRaceGroups || []).map((g, i) => ({
            id: `group-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`,
            name: g.name || '',
            eventId: '',
            eventSecret: '',
            categories: (g.categories || []).map((c) => ({
                category: c.category || '',
                sprints: [],
            })),
            laps: g.laps,
            sprints: [],
            segmentType: 'sprint' as const,
        }));
        return {
            eventMode: 'grouped',
            eventId: '',
            eventSecret: '',
            eventConfiguration: [],
            singleModeCategories: [],
            raceGroups: groups,
        };
    }

    if (mode === 'multi') {
        const eventConfiguration: EventConfig[] = (settings?.defaultEventConfiguration || []).map((row) => ({
            eventId: '',
            eventSecret: '',
            customCategory: row.customCategory || '',
            laps: row.laps,
            startTime: '',
            sprints: [],
            segmentType: 'sprint' as const,
        }));
        return {
            eventMode: 'multi',
            eventId: '',
            eventSecret: '',
            eventConfiguration,
            singleModeCategories: [],
            raceGroups: [],
        };
    }

    const singleModeCategories: CategoryConfig[] = (settings?.defaultSingleCategories || []).map((row) => ({
        category: row.category || '',
        laps: row.laps,
        sprints: [],
        segmentType: 'sprint' as const,
    }));
    return {
        eventMode: 'single',
        eventId: '',
        eventSecret: '',
        eventConfiguration: [],
        singleModeCategories,
        raceGroups: [],
    };
}
