import { useRaceFormContext } from '@/lib/race-form-context';
import EventConfigRow from './EventConfigRow';

export default function MultiModeConfig() {
    const {
        formState,
        segments,
        onAddEventConfig,
        onRemoveEventConfig,
        onUpdateEventConfig,
        onToggleConfigSprint,
    } = useRaceFormContext();

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
