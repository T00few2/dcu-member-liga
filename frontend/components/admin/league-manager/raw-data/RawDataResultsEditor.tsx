'use client';

import type { Race, RaceResult } from '@/types/admin';
import { formatWorldTime, formatElapsedTime, formatPoints } from '@/lib/timeFormat';

type SortConfig = {
    key: string;
    direction: 'asc' | 'desc';
};

type ValueMode = 'worldTime' | 'points' | 'elapsed';

type PendingEdits = Record<string, Record<string, number>>;

interface SprintColumn {
    key: string;
    label: string;
    altKeys: string[];
}

interface RawDataResultsEditorProps {
    selectedRace: Race | null;
    selectedCategory: string;
    results: RaceResult[];
    sprintColumns: SprintColumn[];
    sortConfig: SortConfig;
    valueMode: ValueMode;
    isEditMode: boolean;
    pendingEdits: PendingEdits;
    editingCell: { zwiftId: string; sprintKey: string } | null;
    editValue: string;
    isSaving: boolean;
    saveError: string | null;
    pendingEditCount: number;
    sortedData: Record<string, any>[];
    onSort: (key: string) => void;
    onCellClick: (zwiftId: string, sprintKey: string, currentValue: number | null) => void;
    onEditChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onEditConfirm: () => void;
    onEditCancel: () => void;
    onEditKeyDown: (e: React.KeyboardEvent) => void;
    onDiscardEdits: () => void;
    onSaveEdits: () => void;
    onEnterEditMode: () => void;
    onValueModeChange: (mode: ValueMode) => void;
    raceSelectorSlot: React.ReactNode;
}

function SortIndicator({ columnKey, sortConfig }: { columnKey: string; sortConfig: SortConfig }) {
    if (sortConfig.key !== columnKey) return <span className="text-muted-foreground/30 ml-1">↕</span>;
    return <span className="ml-1">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>;
}

export default function RawDataResultsEditor({
    selectedRace,
    selectedCategory,
    results,
    sprintColumns,
    sortConfig,
    valueMode,
    isEditMode,
    pendingEdits,
    editingCell,
    editValue,
    isSaving,
    saveError,
    pendingEditCount,
    sortedData,
    onSort,
    onCellClick,
    onEditChange,
    onEditConfirm,
    onEditCancel,
    onEditKeyDown,
    onDiscardEdits,
    onSaveEdits,
    onEnterEditMode,
    onValueModeChange,
    raceSelectorSlot,
}: RawDataResultsEditorProps) {
    return (
        <>
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-card-foreground">Results Editor</h2>

                {/* Edit Mode Toggle */}
                {selectedRace && results.length > 0 && selectedRace.type === 'points' && (
                    <div className="flex items-center gap-2">
                        {isEditMode ? (
                            <>
                                <span className="text-sm text-muted-foreground">
                                    {pendingEditCount} pending edit{pendingEditCount !== 1 ? 's' : ''}
                                </span>
                                <button
                                    onClick={onDiscardEdits}
                                    disabled={isSaving}
                                    className="px-3 py-1.5 text-sm rounded-md border border-border text-muted-foreground hover:bg-muted transition disabled:opacity-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={onSaveEdits}
                                    disabled={isSaving || pendingEditCount === 0}
                                    className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
                                >
                                    {isSaving ? 'Saving...' : 'Save & Recalculate'}
                                </button>
                            </>
                        ) : (
                            <button
                                onClick={onEnterEditMode}
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

            {/* Race Selector */}
            {raceSelectorSlot}

            {/* Value Mode Toggle */}
            {selectedRace && results.length > 0 && (
                <div className="flex items-center gap-4 mb-4">
                    <span className="text-sm font-medium text-muted-foreground">Show:</span>
                    <div className="flex gap-1 bg-muted rounded-lg p-1">
                        <button
                            onClick={() => onValueModeChange('worldTime')}
                            className={`px-3 py-1 text-sm rounded-md transition ${
                                valueMode === 'worldTime'
                                    ? 'bg-background text-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            World Time
                        </button>
                        <button
                            onClick={() => onValueModeChange('elapsed')}
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
                            onClick={() => onValueModeChange('points')}
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
                                    onClick={() => onSort('name')}
                                >
                                    Rider <SortIndicator columnKey="name" sortConfig={sortConfig} />
                                </th>
                                <th
                                    className="px-3 py-2 text-right font-medium text-muted-foreground cursor-pointer hover:bg-muted/70 select-none w-24"
                                    onClick={() => onSort('finishRank')}
                                >
                                    Rank <SortIndicator columnKey="finishRank" sortConfig={sortConfig} />
                                </th>
                                <th
                                    className="px-3 py-2 text-right font-medium text-muted-foreground cursor-pointer hover:bg-muted/70 select-none w-32"
                                    onClick={() => onSort('finishTime')}
                                >
                                    Finish Time <SortIndicator columnKey="finishTime" sortConfig={sortConfig} />
                                </th>
                                {sprintColumns.map(col => (
                                    <th
                                        key={col.key}
                                        className="px-3 py-2 text-right font-medium text-muted-foreground cursor-pointer hover:bg-muted/70 select-none whitespace-nowrap"
                                        onClick={() => onSort(col.key)}
                                    >
                                        {col.label} <SortIndicator columnKey={col.key} sortConfig={sortConfig} />
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
                                                onClick={() => onCellClick(row.zwiftId, col.key, row[col.key])}
                                            >
                                                {isEditing ? (
                                                    <input
                                                        type="text"
                                                        value={editValue}
                                                        onChange={onEditChange}
                                                        onBlur={onEditConfirm}
                                                        onKeyDown={onEditKeyDown}
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
        </>
    );
}
