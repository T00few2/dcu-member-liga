import type { Segment, RaceFormState, CategoryConfig } from '@/types/admin';
import SegmentPicker from './SegmentPicker';
import CategoryConfigRow from './CategoryConfigRow';

interface SingleModeConfigProps {
    formState: RaceFormState;
    segments: Segment[];
    segmentsByLap: Record<number, Segment[]>;
    onFieldChange: <K extends keyof RaceFormState>(field: K, value: RaceFormState[K]) => void;
    onToggleSegment: (seg: Segment) => void;
    onAddSingleModeCategory: () => void;
    onRemoveSingleModeCategory: (index: number) => void;
    onUpdateSingleModeCategory: (index: number, field: keyof CategoryConfig, value: CategoryConfig[keyof CategoryConfig]) => void;
    onToggleSingleModeCategorySprint: (configIndex: number, seg: Segment) => void;
}

export default function SingleModeConfig({
    formState,
    segments,
    onFieldChange,
    onToggleSegment,
    onAddSingleModeCategory,
    onRemoveSingleModeCategory,
    onUpdateSingleModeCategory,
    onToggleSingleModeCategorySprint,
}: SingleModeConfigProps) {
    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Zwift Event ID</label>
                    <input
                        type="text"
                        value={formState.eventId}
                        onChange={e => onFieldChange('eventId', e.target.value)}
                        className="w-full p-2 border border-input rounded bg-background text-foreground"
                        placeholder="e.g. 123456"
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Event Secret (Optional)</label>
                    <input
                        type="text"
                        value={formState.eventSecret}
                        onChange={e => onFieldChange('eventSecret', e.target.value)}
                        className="w-full p-2 border border-input rounded bg-background text-foreground"
                        placeholder="e.g. abc123xyz"
                    />
                </div>
            </div>

            <div className="border-t border-border pt-4">
                <div className="flex justify-between items-center mb-3">
                    <div>
                        <label className="block text-sm font-medium text-foreground">Category Configuration</label>
                        <p className="text-xs text-muted-foreground">
                            {formState.singleModeCategories.length === 0
                                ? 'Default: Uses Zwift categories (A, B, C, D, E) with global laps/sprints'
                                : 'Custom: Per-category laps and sprint configuration'}
                        </p>
                    </div>
                    <button type="button" onClick={onAddSingleModeCategory} className="text-sm text-primary hover:text-primary/80 font-medium">
                        + Add Category
                    </button>
                </div>

                {formState.singleModeCategories.length > 0 && (
                    <div className="space-y-3">
                        {formState.singleModeCategories.map((config, idx) => (
                            <CategoryConfigRow
                                key={idx}
                                config={config}
                                index={idx}
                                segments={segments}
                                defaultLaps={formState.laps}
                                onRemove={() => onRemoveSingleModeCategory(idx)}
                                onUpdate={(field, value) => onUpdateSingleModeCategory(idx, field, value)}
                                onToggleSprint={seg => onToggleSingleModeCategorySprint(idx, seg)}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
