import { useRaceFormContext } from '@/lib/race-form-context';
import SegmentPicker from './SegmentPicker';
import CategoryConfigRow from './CategoryConfigRow';

export default function SingleModeConfig() {
    const {
        formState,
        segments,
        onFieldChange,
        onToggleSegment,
        onAddSingleModeCategory,
        onRemoveSingleModeCategory,
        onUpdateSingleModeCategory,
        onToggleSingleModeCategorySprint,
    } = useRaceFormContext();

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

            {formState.singleModeCategories.length === 0 && (
                <div className="border-t border-border pt-4">
                    <div className="mb-3">
                        <label className="block font-medium text-card-foreground mb-1">Segments Used For</label>
                        <select
                            value={formState.segmentType}
                            onChange={e => onFieldChange('segmentType', e.target.value as 'sprint' | 'split')}
                            className="w-full sm:w-64 p-2 border border-input rounded bg-background text-foreground text-sm"
                        >
                            <option value="sprint">Sprint Points</option>
                            <option value="split">Time Trial Splits</option>
                        </select>
                    </div>
                    <label className="block font-medium text-card-foreground mb-3">
                        {formState.segmentType === 'split' ? 'Split Segments' : 'Sprint Segments (Scoring)'}
                    </label>
                    <SegmentPicker
                        segments={segments}
                        selectedSprints={formState.selectedSprints}
                        onToggle={onToggleSegment}
                        segmentType={formState.segmentType}
                    />
                </div>
            )}
        </div>
    );
}
