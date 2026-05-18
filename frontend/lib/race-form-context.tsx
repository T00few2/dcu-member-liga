'use client';

import { createContext, useContext } from 'react';
import type {
    RaceFormState,
    EventConfig,
    CategoryConfig,
    RaceGroup,
    RaceGroupCategoryConfig,
    Segment,
    LoadingStatus,
} from '@/types/admin';

export interface RaceFormContextValue {
    formState: RaceFormState;
    segments: Segment[];
    segmentsByLap: Record<number, Segment[]>;
    status: LoadingStatus;
    onFieldChange: <K extends keyof RaceFormState>(field: K, value: RaceFormState[K]) => void;
    onToggleSegment: (seg: Segment) => void;
    // Multi-mode
    onAddEventConfig: () => void;
    onRemoveEventConfig: (index: number) => void;
    onUpdateEventConfig: (index: number, field: keyof EventConfig, value: EventConfig[keyof EventConfig]) => void;
    onToggleConfigSprint: (configIndex: number, seg: Segment) => void;
    // Single-mode
    onAddSingleModeCategory: () => void;
    onRemoveSingleModeCategory: (index: number) => void;
    onUpdateSingleModeCategory: (index: number, field: keyof CategoryConfig, value: CategoryConfig[keyof CategoryConfig]) => void;
    onToggleSingleModeCategorySprint: (configIndex: number, seg: Segment) => void;
    // Grouped-mode
    onAddRaceGroup: () => void;
    onRemoveRaceGroup: (groupIndex: number) => void;
    onUpdateRaceGroup: (groupIndex: number, field: keyof RaceGroup, value: RaceGroup[keyof RaceGroup]) => void;
    onAddGroupCategory: (groupIndex: number) => void;
    onRemoveGroupCategory: (groupIndex: number, catIndex: number) => void;
    onUpdateGroupCategory: (groupIndex: number, catIndex: number, field: keyof RaceGroupCategoryConfig, value: RaceGroupCategoryConfig[keyof RaceGroupCategoryConfig]) => void;
    onToggleGroupCategorySprint: (groupIndex: number, catIndex: number, seg: Segment) => void;
    onToggleGroupSprint: (groupIndex: number, seg: Segment) => void;
}

const RaceFormContext = createContext<RaceFormContextValue | null>(null);

export function RaceFormProvider({
    value,
    children,
}: {
    value: RaceFormContextValue;
    children: React.ReactNode;
}) {
    return <RaceFormContext.Provider value={value}>{children}</RaceFormContext.Provider>;
}

export function useRaceFormContext(): RaceFormContextValue {
    const ctx = useContext(RaceFormContext);
    if (!ctx) throw new Error('useRaceFormContext must be used within RaceFormProvider');
    return ctx;
}
