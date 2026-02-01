'use client';

import { useState, useMemo } from 'react';
import type { Race, SelectedSegment } from '@/types/admin';

interface RawDataViewerProps {
    races: Race[];
}

type SortConfig = {
    key: string;
    direction: 'asc' | 'desc';
};

// Parse worldTime from sprintDetails value (handles various formats)
const parseWorldTime = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    
    // Handle string format like "worldTime:1234567890;time:12345"
    if (typeof value === 'string' && value.includes('worldTime:')) {
        const match = value.match(/worldTime:(\d+)/);
        if (match) return parseInt(match[1], 10);
    }
    
    // Handle direct number or numeric string
    const parsed = typeof value === 'string' ? parseInt(value, 10) : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

// Format worldTime as readable timestamp
const formatWorldTime = (worldTime: number | null): string => {
    if (worldTime === null) return '-';
    // worldTime is typically in milliseconds since some epoch
    // Display as raw value for now - can be formatted if needed
    return worldTime.toLocaleString();
};

export default function RawDataViewer({ races }: RawDataViewerProps) {
    const [selectedRaceId, setSelectedRaceId] = useState<string>('');
    const [selectedCategory, setSelectedCategory] = useState<string>('');
    const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'name', direction: 'asc' });

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

    // Build table data with worldTime values
    const tableData = useMemo(() => {
        return results.map(rider => {
            const row: Record<string, any> = {
                zwiftId: rider.zwiftId,
                name: rider.name,
                finishTime: rider.finishTime || 0,
                finishRank: rider.finishRank || 0,
            };
            
            // Extract worldTime for each sprint column
            sprintColumns.forEach(col => {
                let worldTime: number | null = null;
                
                // Try primary key first, then alt keys
                const keysToTry = [col.key, ...col.altKeys];
                for (const key of keysToTry) {
                    const value = rider.sprintDetails?.[key];
                    if (value !== undefined) {
                        worldTime = parseWorldTime(value);
                        if (worldTime !== null) break;
                    }
                }
                
                row[col.key] = worldTime;
            });
            
            return row;
        });
    }, [results, sprintColumns]);

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

    // Sort indicator
    const SortIndicator = ({ columnKey }: { columnKey: string }) => {
        if (sortConfig.key !== columnKey) return <span className="text-muted-foreground/30 ml-1">↕</span>;
        return <span className="ml-1">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>;
    };

    return (
        <div className="space-y-6">
            <div className="bg-card p-6 rounded-lg shadow border border-border">
                <h2 className="text-xl font-semibold mb-4 text-card-foreground">Raw Race Data Viewer</h2>
                
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
                            }}
                            className="w-full p-2 border border-input rounded bg-background text-foreground"
                        >
                            <option value="">-- Select a race --</option>
                            {races.map(race => (
                                <option key={race.id} value={race.id}>
                                    {race.date} - {race.name}
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
                            onChange={(e) => setSelectedCategory(e.target.value)}
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

                {/* Info */}
                {selectedRace && results.length > 0 && (
                    <div className="text-sm text-muted-foreground mb-4">
                        {results.length} riders • {sprintColumns.length} segments
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
                                        className="px-3 py-2 text-right font-medium text-muted-foreground cursor-pointer hover:bg-muted/70 select-none w-28"
                                        onClick={() => handleSort('finishTime')}
                                    >
                                        Finish (ms) <SortIndicator columnKey="finishTime" />
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
                                            {row.finishTime > 0 ? row.finishTime.toLocaleString() : '-'}
                                        </td>
                                        {sprintColumns.map(col => (
                                            <td 
                                                key={col.key}
                                                className="px-3 py-2 text-right text-foreground tabular-nums"
                                            >
                                                {formatWorldTime(row[col.key])}
                                            </td>
                                        ))}
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
