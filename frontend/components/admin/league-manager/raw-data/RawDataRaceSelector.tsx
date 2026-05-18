'use client';

import type { Race } from '@/types/admin';

interface RawDataRaceSelectorProps {
    races: Race[];
    selectedRaceId: string;
    selectedCategory: string;
    availableCategories: string[];
    onRaceChange: (raceId: string) => void;
    onCategoryChange: (category: string) => void;
    selectedRace: Race | null;
}

export default function RawDataRaceSelector({
    races,
    selectedRaceId,
    selectedCategory,
    availableCategories,
    onRaceChange,
    onCategoryChange,
    selectedRace,
}: RawDataRaceSelectorProps) {
    return (
        <div className="flex gap-4 mb-6">
            <div className="flex-1">
                <label className="block text-sm font-medium text-muted-foreground mb-1">
                    Select Race
                </label>
                <select
                    value={selectedRaceId}
                    onChange={(e) => onRaceChange(e.target.value)}
                    className="w-full p-2 border border-input rounded bg-background text-foreground"
                >
                    <option value="">-- Select a race --</option>
                    {races.map(race => (
                        <option key={race.id} value={race.id}>
                            {race.date} - {race.name} ({race.type || 'scratch'})
                        </option>
                    ))}
                </select>
            </div>

            <div className="w-48">
                <label className="block text-sm font-medium text-muted-foreground mb-1">
                    Category
                </label>
                <select
                    value={selectedCategory}
                    onChange={(e) => onCategoryChange(e.target.value)}
                    disabled={!selectedRace}
                    className="w-full p-2 border border-input rounded bg-background text-foreground disabled:opacity-50"
                >
                    {availableCategories.length === 0 ? (
                        <option value="">No results</option>
                    ) : (
                        availableCategories.map(cat => (
                            <option key={cat} value={cat}>{cat}</option>
                        ))
                    )}
                </select>
            </div>
        </div>
    );
}
