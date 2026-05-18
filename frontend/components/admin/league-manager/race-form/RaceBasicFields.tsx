'use client';

import { useRaceFormContext } from '@/lib/race-form-context';

export default function RaceBasicFields() {
    const { formState, onFieldChange } = useRaceFormContext();

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Race Name</label>
                <input
                    type="text"
                    required
                    value={formState.name}
                    onChange={e => onFieldChange('name', e.target.value)}
                    className="w-full p-2 border border-input rounded bg-background text-foreground"
                    placeholder="e.g. League Opener"
                />
            </div>
            <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Date & Time</label>
                <input
                    type="datetime-local"
                    required
                    value={formState.date}
                    onChange={e => onFieldChange('date', e.target.value)}
                    className="w-full p-2 border border-input rounded bg-background text-foreground"
                />
            </div>
            <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Race Type</label>
                <select
                    value={formState.raceType}
                    onChange={e => onFieldChange('raceType', e.target.value as 'scratch' | 'points' | 'time-trial')}
                    className="w-full p-2 border border-input rounded bg-background text-foreground"
                >
                    <option value="scratch">Scratch Race</option>
                    <option value="points">Points Race</option>
                    <option value="time-trial">Time Trial</option>
                </select>
            </div>
        </div>
    );
}
