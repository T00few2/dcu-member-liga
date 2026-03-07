import type { Segment, EventConfig } from '@/types/admin';
import { CollapsibleSegmentPicker } from './SegmentPicker';

interface EventConfigRowProps {
    config: EventConfig;
    index: number;
    segments: Segment[];
    defaultLaps: number;
    onRemove: () => void;
    onUpdate: (field: keyof EventConfig, value: EventConfig[keyof EventConfig]) => void;
    onToggleSprint: (seg: Segment) => void;
}

export default function EventConfigRow({
    config,
    segments,
    defaultLaps,
    onRemove,
    onUpdate,
    onToggleSprint,
}: EventConfigRowProps) {
    const maxLaps = config.laps || defaultLaps;
    const filteredSegments = segments.filter(s => (s.lap || 1) <= maxLaps);

    return (
        <div className="flex flex-col gap-2 p-3 bg-muted/20 rounded border border-border">
            <div className="flex gap-2 items-start">
                <div className="flex-1">
                    <label className="text-[10px] text-muted-foreground font-bold uppercase block mb-1">Zwift ID</label>
                    <input
                        type="text"
                        value={config.eventId}
                        onChange={e => onUpdate('eventId', e.target.value)}
                        className="w-full p-2 border border-input rounded bg-background text-foreground text-sm"
                        placeholder="e.g. 12345"
                    />
                </div>
                <div className="flex-1">
                    <label className="text-[10px] text-muted-foreground font-bold uppercase block mb-1">Category Name</label>
                    <input
                        type="text"
                        value={config.customCategory}
                        onChange={e => onUpdate('customCategory', e.target.value)}
                        className="w-full p-2 border border-input rounded bg-background text-foreground text-sm"
                        placeholder="e.g. Elite Men"
                    />
                </div>
                <button type="button" onClick={onRemove} className="text-red-500 hover:text-red-700 px-2 pt-6">✕</button>
            </div>
            <div className="flex gap-2 items-start">
                <div className="flex-1">
                    <label className="text-[10px] text-muted-foreground font-bold uppercase block mb-1">Secret (Opt)</label>
                    <input
                        type="text"
                        value={config.eventSecret}
                        onChange={e => onUpdate('eventSecret', e.target.value)}
                        className="w-full p-2 border border-input rounded bg-background text-foreground text-sm"
                        placeholder="Secret"
                    />
                </div>
                <div className="w-20">
                    <label className="text-[10px] text-muted-foreground font-bold uppercase block mb-1">Laps</label>
                    <input
                        type="number"
                        value={config.laps || defaultLaps}
                        onChange={e => onUpdate('laps', parseInt(e.target.value))}
                        className="w-full p-2 border border-input rounded bg-background text-foreground text-sm"
                        min="1"
                    />
                </div>
                <div className="flex-1">
                    <label className="text-[10px] text-muted-foreground font-bold uppercase block mb-1">Start Time (Opt)</label>
                    <input
                        type="time"
                        value={config.startTime || ''}
                        onChange={e => onUpdate('startTime', e.target.value)}
                        className="w-full p-2 border border-input rounded bg-background text-foreground text-sm"
                    />
                </div>
                <div className="w-32">
                    <label className="text-[10px] text-muted-foreground font-bold uppercase block mb-1">Segments Used For</label>
                    <select
                        value={config.segmentType || 'sprint'}
                        onChange={e => onUpdate('segmentType', e.target.value as 'sprint' | 'split')}
                        className="w-full p-2 border border-input rounded bg-background text-foreground text-sm"
                    >
                        <option value="sprint">Sprint Points</option>
                        <option value="split">Time Trial Splits</option>
                    </select>
                </div>
            </div>
            <div className="mt-2">
                <CollapsibleSegmentPicker
                    segments={filteredSegments}
                    selectedSprints={config.sprints || []}
                    onToggle={onToggleSprint}
                    segmentType={config.segmentType || 'sprint'}
                    maxLaps={maxLaps}
                />
            </div>
        </div>
    );
}
