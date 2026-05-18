'use client';

import { useState, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import type { Race, SelectedSegment, SprintDataEntry } from '@/types/admin';
import { API_URL } from '@/lib/api';
import { MIN_WORLDTIME, formatWorldTime, parseTimeStringToTimestamp } from '@/lib/timeFormat';
import RawDataRaceSelector from './raw-data/RawDataRaceSelector';
import RawDataResultsEditor from './raw-data/RawDataResultsEditor';

interface RawDataViewerProps {
    races: Race[];
    onRaceUpdate?: (race: Race) => void;
}

type SortConfig = {
    key: string;
    direction: 'asc' | 'desc';
};

type ValueMode = 'worldTime' | 'points' | 'elapsed';

// Pending edits: { zwiftId: { sprintKey: newWorldTime } }
type PendingEdits = Record<string, Record<string, number>>;

export default function RawDataViewer({ races, onRaceUpdate }: RawDataViewerProps) {
    const { user } = useAuth();
    const [selectedRaceId, setSelectedRaceId] = useState<string>('');
    const [selectedCategory, setSelectedCategory] = useState<string>('');
    const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'name', direction: 'asc' });
    const [valueMode, setValueMode] = useState<ValueMode>('worldTime');

    // Edit mode state
    const [isEditMode, setIsEditMode] = useState(false);
    const [pendingEdits, setPendingEdits] = useState<PendingEdits>({});
    const [editingCell, setEditingCell] = useState<{ zwiftId: string; sprintKey: string } | null>(null);
    const [editValue, setEditValue] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    // Get selected race
    const selectedRace = useMemo(() =>
        races.find(r => r.id === selectedRaceId) || null,
        [races, selectedRaceId]
    );

    // Get available categories from selected race's results
    const availableCategories = useMemo(() => {
        if (!selectedRace?.results) return [];
        return Object.keys(selectedRace.results).sort();
    }, [selectedRace]);

    // Auto-select first category when race changes
    useMemo(() => {
        if (availableCategories.length > 0 && !availableCategories.includes(selectedCategory)) {
            setSelectedCategory(availableCategories[0]);
        }
    }, [availableCategories, selectedCategory]);

    // Get sprint columns from race configuration
    const sprintColumns = useMemo(() => {
        if (!selectedRace) return [];

        let segments: SelectedSegment[] = [];

        // Check for category-specific configuration
        if (selectedRace.eventMode === 'multi' && selectedRace.eventConfiguration) {
            const catConfig = selectedRace.eventConfiguration.find(c => c.customCategory === selectedCategory);
            if (catConfig?.sprints?.length) {
                segments = catConfig.sprints;
            }
        } else if (selectedRace.singleModeCategories?.length) {
            const catConfig = selectedRace.singleModeCategories.find(c => c.category === selectedCategory);
            if (catConfig?.sprints?.length) {
                segments = catConfig.sprints;
            }
        }

        // Fallback to race-level sprints
        if (segments.length === 0) {
            segments = selectedRace.sprints || [];
        }

        return segments.map(s => ({
            key: s.key,
            label: `${s.name} #${s.count}`,
            altKeys: [`${s.id}_${s.count}`, `${s.id}`].filter(Boolean)
        }));
    }, [selectedRace, selectedCategory]);

    // Get results for selected category
    const results = useMemo(() => {
        if (!selectedRace?.results?.[selectedCategory]) return [];
        return selectedRace.results[selectedCategory];
    }, [selectedRace, selectedCategory]);

    // Build table data with segment values
    const tableData = useMemo(() => {
        return results.map(rider => {
            const row: Record<string, any> = {
                zwiftId: rider.zwiftId,
                name: rider.name,
                finishTime: rider.finishTime || 0,
                finishRank: rider.finishRank || 0,
            };

            // Access sprintData (contains full segment info) and sprintDetails (contains points or worldTime)
            const sprintData = rider.sprintData || {};
            const sprintDetails = rider.sprintDetails || {};

            // Extract values for each sprint column based on mode
            sprintColumns.forEach(col => {
                let value: number | null = null;
                let foundKey: string | null = null;

                // Try primary key first, then alt keys
                const keysToTry = [col.key, ...col.altKeys];
                for (const key of keysToTry) {
                    const dataEntry: SprintDataEntry | undefined = sprintData[key];
                    const detailValue = sprintDetails[key];

                    if (valueMode === 'worldTime') {
                        // First try sprintData.worldTime (points races)
                        if (dataEntry?.worldTime) {
                            value = dataEntry.worldTime;
                            foundKey = key;
                            break;
                        }
                        // Fallback: sprintDetails might have worldTime directly (splits/time-trials)
                        if (typeof detailValue === 'number' && detailValue > MIN_WORLDTIME) {
                            value = detailValue;
                            foundKey = key;
                            break;
                        }
                    } else if (valueMode === 'elapsed' && dataEntry?.time) {
                        value = dataEntry.time;
                        foundKey = key;
                        break;
                    } else if (valueMode === 'points' && typeof detailValue === 'number' && detailValue < MIN_WORLDTIME) {
                        value = detailValue;
                        foundKey = key;
                        break;
                    }
                }

                // Check for pending edit
                const pendingValue = pendingEdits[rider.zwiftId]?.[col.key];
                if (pendingValue !== undefined) {
                    value = pendingValue;
                }

                row[col.key] = value;
                row[`${col.key}_foundKey`] = foundKey || col.key;
            });

            return row;
        });
    }, [results, sprintColumns, valueMode, pendingEdits]);

    // Sort table data
    const sortedData = useMemo(() => {
        const sorted = [...tableData];
        sorted.sort((a, b) => {
            const aVal = a[sortConfig.key];
            const bVal = b[sortConfig.key];

            // Handle null values - always sort to end
            if (aVal === null && bVal === null) return 0;
            if (aVal === null) return 1;
            if (bVal === null) return -1;

            // String comparison for name
            if (sortConfig.key === 'name') {
                const cmp = String(aVal).localeCompare(String(bVal));
                return sortConfig.direction === 'asc' ? cmp : -cmp;
            }

            // Numeric comparison
            const diff = Number(aVal) - Number(bVal);
            return sortConfig.direction === 'asc' ? diff : -diff;
        });
        return sorted;
    }, [tableData, sortConfig]);

    // Handle column header click for sorting
    const handleSort = (key: string) => {
        setSortConfig(prev => ({
            key,
            direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
        }));
    };

    // Handle cell click to start editing
    const handleCellClick = (zwiftId: string, sprintKey: string, currentValue: number | null) => {
        if (!isEditMode || valueMode !== 'worldTime') return;

        setEditingCell({ zwiftId, sprintKey });
        setEditValue(currentValue ? formatWorldTime(currentValue) : '');
    };

    // Handle edit input change
    const handleEditChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setEditValue(e.target.value);
    };

    // Find a reference timestamp for a sprint column (from any rider that has data)
    // This looks at ORIGINAL data, ignoring pending edits
    const findReferenceTimestamp = (sprintKey: string): number | null => {
        // First, try to find from the column's configured keys
        const col = sprintColumns.find(c => c.key === sprintKey);
        const keysToTry = col ? [col.key, ...col.altKeys] : [sprintKey];

        // Search in sprintData (where worldTime is stored for all segment types)
        for (const rider of results) {
            const sprintData = rider.sprintData || {};

            // Try configured keys first
            for (const key of keysToTry) {
                const entry = sprintData[key];
                if (entry?.worldTime && entry.worldTime > MIN_WORLDTIME) {
                    console.log('Found reference timestamp via configured key:', key, entry.worldTime);
                    return entry.worldTime;
                }
            }

            // Try all keys in this rider's sprintData
            for (const key of Object.keys(sprintData)) {
                const entry = sprintData[key];
                if (entry?.worldTime && entry.worldTime > MIN_WORLDTIME) {
                    console.log('Found reference timestamp via any key:', key, entry.worldTime);
                    return entry.worldTime;
                }
            }
        }

        // Check sprintDetails (for splits, worldTime is stored directly)
        for (const rider of results) {
            const sprintDetails = rider.sprintDetails || {};
            for (const key of Object.keys(sprintDetails)) {
                const val = sprintDetails[key];
                if (typeof val === 'number' && val > MIN_WORLDTIME) {
                    console.log('Found reference timestamp in sprintDetails:', key, val);
                    return val;
                }
            }
        }

        console.warn('No reference timestamp found. Results sample:', results.slice(0, 2).map(r => ({
            zwiftId: r.zwiftId,
            sprintData: r.sprintData,
            sprintDetails: r.sprintDetails
        })));

        return null;
    };

    // Handle edit confirm (Enter or blur)
    const handleEditConfirm = () => {
        if (!editingCell) return;

        const { zwiftId, sprintKey } = editingCell;

        // Try to find reference timestamp from multiple sources
        let referenceTimestamp = findReferenceTimestamp(sprintKey);

        // Fallback: use tableData which has already extracted values
        if (!referenceTimestamp) {
            for (const row of tableData) {
                const val = row[sprintKey];
                if (typeof val === 'number' && val > MIN_WORLDTIME) {
                    referenceTimestamp = val;
                    break;
                }
            }
        }

        // Note: We do NOT fallback to race date or current date because
        // Zwift worldTime uses a different epoch than Unix timestamps.
        // Reference must come from existing Zwift data in the same race.

        console.log('Attempting to parse:', { editValue, referenceTimestamp, raceDate: selectedRace?.date });

        const parsed = parseTimeStringToTimestamp(editValue, referenceTimestamp);

        console.log('Parse result:', parsed);

        if (parsed !== null) {
            setPendingEdits(prev => ({
                ...prev,
                [zwiftId]: {
                    ...prev[zwiftId],
                    [sprintKey]: parsed
                }
            }));
        } else if (editValue.trim() !== '') {
            // Show more helpful error with debug info
            console.error('Parse failed:', { editValue, referenceTimestamp, sprintKey, raceDate: selectedRace?.date });
            alert(`Could not parse time "${editValue}". Use format HH:MM:SS.mmm or paste a raw timestamp.${!referenceTimestamp ? ' (No reference timestamp found)' : ''}`);
        }

        setEditingCell(null);
        setEditValue('');
    };

    // Handle edit cancel (Escape)
    const handleEditCancel = () => {
        setEditingCell(null);
        setEditValue('');
    };

    // Handle key press in edit input
    const handleEditKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleEditConfirm();
        } else if (e.key === 'Escape') {
            handleEditCancel();
        }
    };

    // Clear all pending edits
    const handleDiscardEdits = () => {
        setPendingEdits({});
        setIsEditMode(false);
    };

    // Save pending edits to backend
    const handleSaveEdits = async () => {
        if (!user || !selectedRaceId || !selectedCategory || Object.keys(pendingEdits).length === 0) return;

        setIsSaving(true);
        setSaveError(null);

        try {
            const token = await user.getIdToken();

            // Build updates array
            const updates = Object.entries(pendingEdits).map(([zwiftId, sprints]) => ({
                zwiftId,
                sprintData: Object.fromEntries(
                    Object.entries(sprints).map(([key, worldTime]) => [
                        key,
                        { worldTime }
                    ])
                )
            }));

            const response = await fetch(
                `${API_URL}/races/${selectedRaceId}/results/${selectedCategory}/sprints`,
                {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                    },
                    body: JSON.stringify({ updates }),
                }
            );

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.message || 'Failed to save');
            }

            const data = await response.json();

            // Update local race data if callback provided
            if (onRaceUpdate && selectedRace) {
                onRaceUpdate({
                    ...selectedRace,
                    results: data.results
                });
            }

            // Clear edits and exit edit mode
            setPendingEdits({});
            setIsEditMode(false);

            alert('Changes saved and points recalculated!');

        } catch (err) {
            console.error('Save error:', err);
            setSaveError(err instanceof Error ? err.message : 'Failed to save changes');
        } finally {
            setIsSaving(false);
        }
    };

    // Count pending edits
    const pendingEditCount = Object.values(pendingEdits).reduce(
        (sum, sprints) => sum + Object.keys(sprints).length,
        0
    );

    return (
        <div className="space-y-6">
            <div className="bg-card p-6 rounded-lg shadow border border-border">
                <RawDataResultsEditor
                    selectedRace={selectedRace}
                    selectedCategory={selectedCategory}
                    results={results}
                    sprintColumns={sprintColumns}
                    sortConfig={sortConfig}
                    valueMode={valueMode}
                    isEditMode={isEditMode}
                    pendingEdits={pendingEdits}
                    editingCell={editingCell}
                    editValue={editValue}
                    isSaving={isSaving}
                    saveError={saveError}
                    pendingEditCount={pendingEditCount}
                    sortedData={sortedData}
                    onSort={handleSort}
                    onCellClick={handleCellClick}
                    onEditChange={handleEditChange}
                    onEditConfirm={handleEditConfirm}
                    onEditCancel={handleEditCancel}
                    onEditKeyDown={handleEditKeyDown}
                    onDiscardEdits={handleDiscardEdits}
                    onSaveEdits={handleSaveEdits}
                    onEnterEditMode={() => {
                        setIsEditMode(true);
                        setValueMode('worldTime');
                    }}
                    onValueModeChange={setValueMode}
                    raceSelectorSlot={
                        <RawDataRaceSelector
                            races={races}
                            selectedRaceId={selectedRaceId}
                            selectedCategory={selectedCategory}
                            availableCategories={availableCategories}
                            onRaceChange={(raceId) => {
                                setSelectedRaceId(raceId);
                                setSelectedCategory('');
                                setPendingEdits({});
                                setIsEditMode(false);
                            }}
                            onCategoryChange={(category) => {
                                setSelectedCategory(category);
                                setPendingEdits({});
                            }}
                            selectedRace={selectedRace}
                        />
                    }
                />
            </div>
        </div>
    );
}
