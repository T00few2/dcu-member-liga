'use client';

import type { Segment, RaceFormState, RaceGroup, RaceGroupCategoryConfig } from '@/types/admin';
import { CollapsibleSegmentPicker } from './SegmentPicker';

interface GroupedModeConfigProps {
    formState: RaceFormState;
    segments: Segment[];
    segmentsByLap: Record<number, Segment[]>;
    onAddRaceGroup: () => void;
    onRemoveRaceGroup: (groupIndex: number) => void;
    onUpdateRaceGroup: (groupIndex: number, field: keyof RaceGroup, value: RaceGroup[keyof RaceGroup]) => void;
    onAddGroupCategory: (groupIndex: number) => void;
    onRemoveGroupCategory: (groupIndex: number, catIndex: number) => void;
    onUpdateGroupCategory: (groupIndex: number, catIndex: number, field: keyof RaceGroupCategoryConfig, value: RaceGroupCategoryConfig[keyof RaceGroupCategoryConfig]) => void;
    onToggleGroupCategorySprint: (groupIndex: number, catIndex: number, seg: Segment) => void;
    onToggleGroupSprint: (groupIndex: number, seg: Segment) => void;
}

export default function GroupedModeConfig({
    formState,
    segments,
    onAddRaceGroup,
    onRemoveRaceGroup,
    onUpdateRaceGroup,
    onAddGroupCategory,
    onRemoveGroupCategory,
    onUpdateGroupCategory,
    onToggleGroupCategorySprint,
    onToggleGroupSprint,
}: GroupedModeConfigProps) {
    return (
        <div className="space-y-4">
            {formState.raceGroups.map((group, groupIdx) => {
                const groupMaxLaps = group.laps || formState.laps;
                const filteredSegments = segments.filter(s => (s.lap || 1) <= groupMaxLaps);

                return (
                    <div key={group.id} className="p-4 bg-muted/20 rounded-lg border border-border space-y-3">
                        {/* Group header row */}
                        <div className="flex gap-2 items-start">
                            <div className="flex-1">
                                <label className="text-[10px] text-muted-foreground font-bold uppercase block mb-1">Group Name</label>
                                <input
                                    type="text"
                                    value={group.name}
                                    onChange={e => onUpdateRaceGroup(groupIdx, 'name', e.target.value)}
                                    className="w-full p-2 border border-input rounded bg-background text-foreground text-sm"
                                    placeholder="e.g. High end"
                                />
                            </div>
                            <div className="flex-1">
                                <label className="text-[10px] text-muted-foreground font-bold uppercase block mb-1">Zwift Event ID</label>
                                <input
                                    type="text"
                                    value={group.eventId}
                                    onChange={e => onUpdateRaceGroup(groupIdx, 'eventId', e.target.value)}
                                    className="w-full p-2 border border-input rounded bg-background text-foreground text-sm"
                                    placeholder="e.g. 12345"
                                />
                            </div>
                            <div className="flex-1">
                                <label className="text-[10px] text-muted-foreground font-bold uppercase block mb-1">Secret (Opt)</label>
                                <input
                                    type="text"
                                    value={group.eventSecret || ''}
                                    onChange={e => onUpdateRaceGroup(groupIdx, 'eventSecret', e.target.value)}
                                    className="w-full p-2 border border-input rounded bg-background text-foreground text-sm"
                                    placeholder="Secret"
                                />
                            </div>
                            <button
                                type="button"
                                onClick={() => onRemoveRaceGroup(groupIdx)}
                                className="text-red-500 hover:text-red-700 px-2 pt-6"
                            >
                                ✕
                            </button>
                        </div>

                        {/* Group-level laps + segment type */}
                        <div className="flex gap-2 items-start">
                            <div className="w-20">
                                <label className="text-[10px] text-muted-foreground font-bold uppercase block mb-1">Laps</label>
                                <input
                                    type="number"
                                    value={groupMaxLaps}
                                    onChange={e => onUpdateRaceGroup(groupIdx, 'laps', parseInt(e.target.value) || 1)}
                                    className="w-full p-2 border border-input rounded bg-background text-foreground text-sm"
                                    min="1"
                                />
                            </div>
                            <div className="w-40">
                                <label className="text-[10px] text-muted-foreground font-bold uppercase block mb-1">Segments Used For</label>
                                <select
                                    value={group.segmentType || 'sprint'}
                                    onChange={e => onUpdateRaceGroup(groupIdx, 'segmentType', e.target.value as 'sprint' | 'split')}
                                    className="w-full p-2 border border-input rounded bg-background text-foreground text-sm"
                                >
                                    <option value="sprint">Sprint Points</option>
                                    <option value="split">Time Trial Splits</option>
                                </select>
                            </div>
                        </div>

                        {/* Group-level sprint picker (shared default for all categories in this group) */}
                        <div>
                            <CollapsibleSegmentPicker
                                segments={filteredSegments}
                                selectedSprints={group.sprints || []}
                                onToggle={seg => onToggleGroupSprint(groupIdx, seg)}
                                segmentType={group.segmentType || 'sprint'}
                                maxLaps={groupMaxLaps}
                                title="Group-level Segments (default for all categories)"
                            />
                        </div>

                        {/* Categories within this group */}
                        <div className="space-y-2">
                            <label className="text-[10px] text-muted-foreground font-bold uppercase block">
                                Categories in this group
                            </label>
                            {group.categories.map((cat, catIdx) => {
                                const catMaxLaps = cat.laps || groupMaxLaps;
                                const catSegments = segments.filter(s => (s.lap || 1) <= catMaxLaps);
                                return (
                                    <div key={catIdx} className="p-2 bg-background rounded border border-border space-y-2">
                                        <div className="flex gap-2 items-center">
                                            <div className="flex-1">
                                                <label className="text-[10px] text-muted-foreground font-bold uppercase block mb-1">
                                                    Category Name
                                                </label>
                                                <input
                                                    type="text"
                                                    value={cat.category}
                                                    onChange={e => onUpdateGroupCategory(groupIdx, catIdx, 'category', e.target.value)}
                                                    className="w-full p-2 border border-input rounded bg-background text-foreground text-sm"
                                                    placeholder="e.g. Diamond"
                                                />
                                            </div>
                                            <div className="w-20">
                                                <label className="text-[10px] text-muted-foreground font-bold uppercase block mb-1">Laps</label>
                                                <input
                                                    type="number"
                                                    value={cat.laps || groupMaxLaps}
                                                    onChange={e => onUpdateGroupCategory(groupIdx, catIdx, 'laps', parseInt(e.target.value) || 1)}
                                                    className="w-full p-2 border border-input rounded bg-background text-foreground text-sm"
                                                    min="1"
                                                />
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => onRemoveGroupCategory(groupIdx, catIdx)}
                                                className="text-red-500 hover:text-red-700 px-2 pt-5"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                        <CollapsibleSegmentPicker
                                            segments={catSegments}
                                            selectedSprints={cat.sprints || []}
                                            onToggle={seg => onToggleGroupCategorySprint(groupIdx, catIdx, seg)}
                                            segmentType={cat.segmentType || group.segmentType || 'sprint'}
                                            maxLaps={catMaxLaps}
                                            title="Per-category Segments (overrides group)"
                                        />
                                    </div>
                                );
                            })}
                            <button
                                type="button"
                                onClick={() => onAddGroupCategory(groupIdx)}
                                className="text-xs text-primary hover:text-primary/80 font-medium"
                            >
                                + Add Category
                            </button>
                        </div>
                    </div>
                );
            })}

            <button type="button" onClick={onAddRaceGroup} className="text-sm text-primary hover:text-primary/80 font-medium">
                + Add Group
            </button>
        </div>
    );
}
