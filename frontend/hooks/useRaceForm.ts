'use client';

import { useState, useCallback, useEffect } from 'react';
import type { 
    Race, 
    RaceFormState, 
    Segment, 
    SelectedSegment, 
    CategoryConfig, 
    EventConfig 
} from '@/types/admin';

const initialFormState: RaceFormState = {
    editingRaceId: null,
    name: '',
    date: '',
    raceType: 'scratch',
    eventId: '',
    eventSecret: '',
    eventMode: 'single',
    eventConfiguration: [],
    singleModeCategories: [],
    selectedMap: '',
    selectedRouteId: '',
    laps: 1,
    selectedSprints: [],
    segmentType: 'sprint',
};

export function useRaceForm() {
    const [formState, setFormState] = useState<RaceFormState>(initialFormState);

    // Sync segmentType with raceType
    useEffect(() => {
        if (formState.raceType === 'time-trial') {
            setFormState(prev => ({ ...prev, segmentType: 'split' }));
        } else {
            setFormState(prev => ({ ...prev, segmentType: 'sprint' }));
        }
    }, [formState.raceType]);

    // Update a single form field
    const updateField = useCallback(<K extends keyof RaceFormState>(
        field: K, 
        value: RaceFormState[K]
    ) => {
        setFormState(prev => ({ ...prev, [field]: value }));
    }, []);

    // Load a race for editing
    const loadRace = useCallback((race: Race) => {
        const newState: RaceFormState = {
            editingRaceId: race.id,
            name: race.name,
            date: race.date,
            raceType: race.type || 'scratch',
            eventId: race.eventId || '',
            eventSecret: race.eventSecret || '',
            eventMode: race.eventMode || 'single',
            selectedMap: race.map,
            selectedRouteId: race.routeId,
            laps: race.laps,
            segmentType: race.segmentType || 'sprint',
            selectedSprints: race.sprints || [],
            eventConfiguration: [],
            singleModeCategories: [],
        };

        // Handle multi mode
        if (race.eventMode === 'multi' && race.eventConfiguration) {
            newState.eventConfiguration = race.eventConfiguration.map(c => ({
                ...c,
                sprints: c.sprints || [],
                segmentType: c.segmentType || 'sprint',
            }));
        } else {
            // Handle single mode category config
            if (race.singleModeCategories && race.singleModeCategories.length > 0) {
                newState.singleModeCategories = race.singleModeCategories.map(c => ({
                    ...c,
                    sprints: c.sprints || [],
                    segmentType: c.segmentType || 'sprint',
                }));
            }
        }

        setFormState(newState);
    }, []);

    // Reset form to initial state
    const resetForm = useCallback(() => {
        setFormState(initialFormState);
    }, []);

    // Toggle segment selection
    const toggleSegment = useCallback((seg: Segment) => {
        const key = `${seg.id}_${seg.count}`;
        setFormState(prev => {
            const isSelected = prev.selectedSprints.some(s => s.key === key);
            return {
                ...prev,
                selectedSprints: isSelected
                    ? prev.selectedSprints.filter(s => s.key !== key)
                    : [...prev.selectedSprints, { ...seg, key }],
            };
        });
    }, []);

    // Event configuration helpers
    const addEventConfig = useCallback(() => {
        setFormState(prev => ({
            ...prev,
            eventConfiguration: [
                ...prev.eventConfiguration,
                { 
                    eventId: '', 
                    eventSecret: '', 
                    customCategory: '', 
                    laps: prev.laps, 
                    startTime: '', 
                    sprints: [], 
                    segmentType: 'sprint' 
                },
            ],
        }));
    }, []);

    const removeEventConfig = useCallback((index: number) => {
        setFormState(prev => ({
            ...prev,
            eventConfiguration: prev.eventConfiguration.filter((_, i) => i !== index),
        }));
    }, []);

    const updateEventConfig = useCallback((
        index: number, 
        field: keyof EventConfig, 
        value: EventConfig[keyof EventConfig]
    ) => {
        setFormState(prev => ({
            ...prev,
            eventConfiguration: prev.eventConfiguration.map((c, i) => 
                i === index ? { ...c, [field]: value } : c
            ),
        }));
    }, []);

    const toggleConfigSprint = useCallback((configIndex: number, seg: Segment) => {
        const key = `${seg.id}_${seg.count}`;
        setFormState(prev => ({
            ...prev,
            eventConfiguration: prev.eventConfiguration.map((config, i) => {
                if (i !== configIndex) return config;
                const currentSprints = config.sprints || [];
                const isSelected = currentSprints.some(s => s.key === key);
                return {
                    ...config,
                    sprints: isSelected
                        ? currentSprints.filter(s => s.key !== key)
                        : [...currentSprints, { ...seg, key }],
                };
            }),
        }));
    }, []);

    // Single mode category helpers
    const addSingleModeCategory = useCallback(() => {
        setFormState(prev => {
            const defaultCategories = ['A', 'B', 'C', 'D', 'E'];
            const usedCategories = prev.singleModeCategories.map(c => c.category);
            const nextCategory = defaultCategories.find(c => !usedCategories.includes(c)) || '';
            return {
                ...prev,
                singleModeCategories: [
                    ...prev.singleModeCategories,
                    { 
                        category: nextCategory, 
                        laps: prev.laps, 
                        sprints: [], 
                        segmentType: 'sprint' 
                    },
                ],
            };
        });
    }, []);

    const removeSingleModeCategory = useCallback((index: number) => {
        setFormState(prev => ({
            ...prev,
            singleModeCategories: prev.singleModeCategories.filter((_, i) => i !== index),
        }));
    }, []);

    const updateSingleModeCategory = useCallback((
        index: number, 
        field: keyof CategoryConfig, 
        value: CategoryConfig[keyof CategoryConfig]
    ) => {
        setFormState(prev => ({
            ...prev,
            singleModeCategories: prev.singleModeCategories.map((c, i) => 
                i === index ? { ...c, [field]: value } : c
            ),
        }));
    }, []);

    const toggleSingleModeCategorySprint = useCallback((configIndex: number, seg: Segment) => {
        const key = `${seg.id}_${seg.count}`;
        setFormState(prev => ({
            ...prev,
            singleModeCategories: prev.singleModeCategories.map((config, i) => {
                if (i !== configIndex) return config;
                const currentSprints = config.sprints || [];
                const isSelected = currentSprints.some(s => s.key === key);
                return {
                    ...config,
                    sprints: isSelected
                        ? currentSprints.filter(s => s.key !== key)
                        : [...currentSprints, { ...seg, key }],
                };
            }),
        }));
    }, []);

    return {
        formState,
        updateField,
        loadRace,
        resetForm,
        toggleSegment,
        // Event config
        addEventConfig,
        removeEventConfig,
        updateEventConfig,
        toggleConfigSprint,
        // Single mode categories
        addSingleModeCategory,
        removeSingleModeCategory,
        updateSingleModeCategory,
        toggleSingleModeCategorySprint,
        // Convenience getters
        isEditing: formState.editingRaceId !== null,
    };
}
