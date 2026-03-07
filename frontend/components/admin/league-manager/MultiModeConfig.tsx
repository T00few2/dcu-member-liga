import type { Segment, RaceFormState, EventConfig } from '@/types/admin';
import EventConfigRow from './EventConfigRow';

interface MultiModeConfigProps {
    formState: RaceFormState;
    segments: Segment[];
    segmentsByLap: Record<number, Segment[]>;
    onAddEventConfig: () => void;
    onRemoveEventConfig: (index: number) => void;
    onUpdateEventConfig: (index: number, field: keyof EventConfig, value: EventConfig[keyof EventConfig]) => void;
    onToggleConfigSprint: (configIndex: number, seg: Segment) => void;
}

export default function MultiModeConfig({
    formState,
    segments,
    onAddEventConfig,
    onRemoveEventConfig,
    onUpdateEventConfig,
    onToggleConfigSprint,
}: MultiModeConfigProps) {
    return (
        <div className="space-y-3">
            {formState.eventConfiguration.map((config, idx) => (
                <EventConfigRow
                    key={idx}
                    config={config}
                    index={idx}
                    segments={segments}
                    defaultLaps={formState.laps}
                    onRemove={() => onRemoveEventConfig(idx)}
                    onUpdate={(field, value) => onUpdateEventConfig(idx, field, value)}
                    onToggleSprint={seg => onToggleConfigSprint(idx, seg)}
                />
            ))}
            <button type="button" onClick={onAddEventConfig} className="text-sm text-primary hover:text-primary/80 font-medium">
                + Add Category Source
            </button>
        </div>
    );
}
