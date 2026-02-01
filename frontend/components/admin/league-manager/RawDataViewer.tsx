'use client';

import { useState, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import type { Race, SelectedSegment, SprintDataEntry } from '@/types/admin';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

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

// Format worldTime (Unix timestamp in ms) as HH:MM:SS.mmm
const formatWorldTime = (ms: number | null): string => {
    if (ms === null || ms === undefined) return '-';
    const date = new Date(ms);
    const hours = date.getUTCHours().toString().padStart(2, '0');
    const minutes = date.getUTCMinutes().toString().padStart(2, '0');
    const seconds = date.getUTCSeconds().toString().padStart(2, '0');
    const millis = date.getUTCMilliseconds().toString().padStart(3, '0');
    return `${hours}:${minutes}:${seconds}.${millis}`;
};

// Parse time string (HH:MM:SS.mmm or MM:SS.mmm) to milliseconds
const parseTimeString = (str: string): number | null => {
    if (!str || str === '-') return null;
    
    // Try HH:MM:SS.mmm format
    const fullMatch = str.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
    if (fullMatch) {
        const hours = parseInt(fullMatch[1], 10);
        const minutes = parseInt(fullMatch[2], 10);
        const seconds = parseInt(fullMatch[3], 10);
        const millis = fullMatch[4] ? parseInt(fullMatch[4].padEnd(3, '0'), 10) : 0;
        return ((hours * 3600 + minutes * 60 + seconds) * 1000) + millis;
    }
    
    // Try MM:SS.mmm format
    const shortMatch = str.match(/^(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/);
    if (shortMatch) {
        const minutes = parseInt(shortMatch[1], 10);
        const seconds = parseInt(shortMatch[2], 10);
        const millis = shortMatch[3] ? parseInt(shortMatch[3].padEnd(3, '0'), 10) : 0;
        return ((minutes * 60 + seconds) * 1000) + millis;
    }
    
    // Try plain number (ms)
    const num = parseInt(str, 10);
    if (!isNaN(num)) return num;
    
    return null;
};

// Format elapsed time (duration in ms) as MM:SS.mmm
const formatElapsedTime = (ms: number | null): string => {
    if (ms === null || ms === undefined || ms === 0) return '-';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const millis = ms % 1000;
    return `${minutes}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
};

// Format points (just a number)
const formatPoints = (value: number | null): string => {
    if (value === null || value === undefined) return '-';
    return value.toString();
};

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
                    
                    if (valueMode === 'worldTime' && dataEntry?.worldTime) {
                        value = dataEntry.worldTime;
                        foundKey = key;
                        break;
                    } else if (valueMode === 'elapsed' && dataEntry?.time) {
                        value = dataEntry.time;
                        foundKey = key;
                        break;
                    } else if (valueMode === 'points' && typeof detailValue === 'number') {
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

    // Handle edit confirm (Enter or blur)
    const handleEditConfirm = () => {
        if (!editingCell) return;
        
        const { zwiftId, sprintKey } = editingCell;
        const parsed = parseTimeString(editValue);
        
        if (parsed !== null) {
            setPendingEdits(prev => ({
                ...prev,
                [zwiftId]: {
                    ...prev[zwiftId],
                    [sprintKey]: parsed
                }
            }));
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

    // Sort indicator
    const SortIndicator = ({ columnKey }: { columnKey: string }) => {
        if (sortConfig.key !== columnKey) return <span className="text-muted-foreground/30 ml-1">↕</span>;
        return <span className="ml-1">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>;
    };

    return (
        <div className="space-y-6">
            <div className="bg-card p-6 rounded-lg shadow border border-border">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold text-card-foreground">Raw Race Data Viewer</h2>
                    
                    {/* Edit Mode Toggle */}
                    {selectedRace && results.length > 0 && selectedRace.type === 'points' && (
                        <div className="flex items-center gap-2">
                            {isEditMode ? (
                                <>
                                    <span className="text-sm text-muted-foreground">
                                        {pendingEditCount} pending edit{pendingEditCount !== 1 ? 's' : ''}
                                    </span>
                                    <button
                                        onClick={handleDiscardEdits}
                                        disabled={isSaving}
                                        className="px-3 py-1.5 text-sm rounded-md border border-border text-muted-foreground hover:bg-muted transition disabled:opacity-50"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleSaveEdits}
                                        disabled={isSaving || pendingEditCount === 0}
                                        className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
                                    >
                                        {isSaving ? 'Saving...' : 'Save & Recalculate'}
                                    </button>
                                </>
                            ) : (
                                <button
                                    onClick={() => {
                                        setIsEditMode(true);
                                        setValueMode('worldTime');
                                    }}
                                    className="px-3 py-1.5 text-sm rounded-md border border-border text-foreground hover:bg-muted transition"
                                >
                                    Edit World Times
                                </button>
                            )}
                        </div>
                    )}
                </div>
                
                {saveError && (
                    <div className="mb-4 p-3 bg-destructive/10 border border-destructive/30 rounded-md text-destructive text-sm">
                        {saveError}
                    </div>
                )}
                
                {/* Selectors */}
                <div className="flex gap-4 mb-6">
                    <div className="flex-1">
                        <label className="block text-sm font-medium text-muted-foreground mb-1">
                            Select Race
                        </label>
                        <select
                            value={selectedRaceId}
                            onChange={(e) => {
                                setSelectedRaceId(e.target.value);
                                setSelectedCategory('');
                                setPendingEdits({});
                                setIsEditMode(false);
                            }}
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
                            onChange={(e) => {
                                setSelectedCategory(e.target.value);
                                setPendingEdits({});
                            }}
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

                {/* Value Mode Toggle */}
                {selectedRace && results.length > 0 && (
                    <div className="flex items-center gap-4 mb-4">
                        <span className="text-sm font-medium text-muted-foreground">Show:</span>
                        <div className="flex gap-1 bg-muted rounded-lg p-1">
                            <button
                                onClick={() => setValueMode('worldTime')}
                                className={`px-3 py-1 text-sm rounded-md transition ${
                                    valueMode === 'worldTime' 
                                        ? 'bg-background text-foreground shadow-sm' 
                                        : 'text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                World Time
                            </button>
                            <button
                                onClick={() => setValueMode('elapsed')}
                                disabled={isEditMode}
                                className={`px-3 py-1 text-sm rounded-md transition ${
                                    valueMode === 'elapsed' 
                                        ? 'bg-background text-foreground shadow-sm' 
                                        : 'text-muted-foreground hover:text-foreground'
                                } ${isEditMode ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                                Elapsed Time
                            </button>
                            <button
                                onClick={() => setValueMode('points')}
                                disabled={isEditMode}
                                className={`px-3 py-1 text-sm rounded-md transition ${
                                    valueMode === 'points' 
                                        ? 'bg-background text-foreground shadow-sm' 
                                        : 'text-muted-foreground hover:text-foreground'
                                } ${isEditMode ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                                Points
                            </button>
                        </div>
                        <span className="text-sm text-muted-foreground ml-auto">
                            {results.length} riders • {sprintColumns.length} segments
                        </span>
                    </div>
                )}
                
                {isEditMode && (
                    <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-md text-blue-700 dark:text-blue-300 text-sm">
                        Click on any World Time cell to edit. Enter time as HH:MM:SS.mmm or paste a raw timestamp. Press Enter to confirm or Escape to cancel.
                    </div>
                )}

                {/* Table */}
                {selectedRace && results.length > 0 ? (
                    <div className="overflow-x-auto border border-border rounded-lg">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-muted/50 border-b border-border">
                                    <th 
                                        className="px-3 py-2 text-left font-medium text-muted-foreground cursor-pointer hover:bg-muted/70 select-none"
                                        onClick={() => handleSort('name')}
                                    >
                                        Rider <SortIndicator columnKey="name" />
                                    </th>
                                    <th 
                                        className="px-3 py-2 text-right font-medium text-muted-foreground cursor-pointer hover:bg-muted/70 select-none w-24"
                                        onClick={() => handleSort('finishRank')}
                                    >
                                        Rank <SortIndicator columnKey="finishRank" />
                                    </th>
                                    <th 
                                        className="px-3 py-2 text-right font-medium text-muted-foreground cursor-pointer hover:bg-muted/70 select-none w-32"
                                        onClick={() => handleSort('finishTime')}
                                    >
                                        Finish Time <SortIndicator columnKey="finishTime" />
                                    </th>
                                    {sprintColumns.map(col => (
                                        <th
                                            key={col.key}
                                            className="px-3 py-2 text-right font-medium text-muted-foreground cursor-pointer hover:bg-muted/70 select-none whitespace-nowrap"
                                            onClick={() => handleSort(col.key)}
                                        >
                                            {col.label} <SortIndicator columnKey={col.key} />
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {sortedData.map((row, idx) => (
                                    <tr 
                                        key={row.zwiftId}
                                        className={`border-b border-border/50 ${idx % 2 === 0 ? '' : 'bg-muted/20'}`}
                                    >
                                        <td className="px-3 py-2 text-foreground">
                                            <div className="font-medium">{row.name}</div>
                                            <div className="text-xs text-muted-foreground">{row.zwiftId}</div>
                                        </td>
                                        <td className="px-3 py-2 text-right text-foreground tabular-nums">
                                            {row.finishRank > 0 ? row.finishRank : '-'}
                                        </td>
                                        <td className="px-3 py-2 text-right text-foreground tabular-nums">
                                            {formatElapsedTime(row.finishTime)}
                                        </td>
                                        {sprintColumns.map(col => {
                                            const isEditing = editingCell?.zwiftId === row.zwiftId && editingCell?.sprintKey === col.key;
                                            const hasPendingEdit = pendingEdits[row.zwiftId]?.[col.key] !== undefined;
                                            
                                            return (
                                                <td 
                                                    key={col.key}
                                                    className={`px-3 py-2 text-right tabular-nums ${
                                                        isEditMode && valueMode === 'worldTime' 
                                                            ? 'cursor-pointer hover:bg-primary/10' 
                                                            : ''
                                                    } ${hasPendingEdit ? 'bg-yellow-500/20' : 'text-foreground'}`}
                                                    onClick={() => handleCellClick(row.zwiftId, col.key, row[col.key])}
                                                >
                                                    {isEditing ? (
                                                        <input
                                                            type="text"
                                                            value={editValue}
                                                            onChange={handleEditChange}
                                                            onBlur={handleEditConfirm}
                                                            onKeyDown={handleEditKeyDown}
                                                            autoFocus
                                                            className="w-full px-1 py-0.5 text-right bg-background border border-primary rounded text-sm"
                                                        />
                                                    ) : (
                                                        valueMode === 'worldTime' 
                                                            ? formatWorldTime(row[col.key])
                                                            : valueMode === 'elapsed'
                                                            ? formatElapsedTime(row[col.key])
                                                            : formatPoints(row[col.key])
                                                    )}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : selectedRace ? (
                    <div className="text-center py-8 text-muted-foreground">
                        No results available for this race/category.
                    </div>
                ) : (
                    <div className="text-center py-8 text-muted-foreground">
                        Select a race to view raw data.
                    </div>
                )}
            </div>
        </div>
    );
}
