'use client';

import type { Race, LoadingStatus, ResultSource } from '@/types/admin';

interface RaceListProps {
    races: Race[];
    editingRaceId: string | null;
    status: LoadingStatus;
    resultSource: ResultSource;
    filterRegistered: boolean;
    categoryFilter: string;
    onResultSourceChange: (source: ResultSource) => void;
    onFilterRegisteredChange: (value: boolean) => void;
    onCategoryFilterChange: (value: string) => void;
    onEdit: (race: Race) => void;
    onDelete: (id: string) => void;
    onRefreshResults: (id: string) => void;
    onViewResults: (id: string) => void;
}

export default function RaceList({
    races,
    editingRaceId,
    status,
    resultSource,
    filterRegistered,
    categoryFilter,
    onResultSourceChange,
    onFilterRegisteredChange,
    onCategoryFilterChange,
    onEdit,
    onDelete,
    onRefreshResults,
    onViewResults,
}: RaceListProps) {
    return (
        <div className="bg-card rounded-lg shadow overflow-hidden border border-border">
            <div className="flex flex-col gap-4 p-6 border-b border-border">
                <div className="flex justify-between items-end">
                    <h2 className="text-xl font-semibold text-card-foreground">Scheduled Races</h2>
                    
                    <div className="flex flex-col gap-2 items-end">
                        <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                            Results Fetch Options
                        </span>
                        <div className="flex items-center gap-4 p-2 bg-muted/30 rounded-lg border border-border/50">
                            <div className="flex items-center gap-2">
                                <label className="text-sm text-muted-foreground font-medium">Category:</label>
                                <select 
                                    value={categoryFilter}
                                    onChange={(e) => onCategoryFilterChange(e.target.value)}
                                    className="bg-background border border-input rounded px-2 py-1 text-sm font-medium text-foreground focus:ring-1 focus:ring-primary"
                                >
                                    {['All', 'A', 'B', 'C', 'D', 'E'].map(cat => (
                                        <option key={cat} value={cat}>{cat}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex items-center gap-2">
                                <label className="text-sm text-muted-foreground font-medium">Source:</label>
                                <select 
                                    value={resultSource}
                                    onChange={(e) => onResultSourceChange(e.target.value as ResultSource)}
                                    className="bg-background border border-input rounded px-2 py-1 text-sm font-medium text-foreground focus:ring-1 focus:ring-primary"
                                >
                                    <option value="finishers">Finishers</option>
                                    <option value="joined">Joined</option>
                                    <option value="signed_up">Signed Up</option>
                                </select>
                            </div>
                            <label className="flex items-center gap-2 cursor-pointer border-l border-border pl-4">
                                <input 
                                    type="checkbox"
                                    checked={filterRegistered}
                                    onChange={(e) => onFilterRegisteredChange(e.target.checked)}
                                    className="w-4 h-4 rounded border-input text-primary focus:ring-primary"
                                />
                                <span className="text-sm text-muted-foreground select-none">Filter Registered</span>
                            </label>
                        </div>
                    </div>
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-muted/50 text-muted-foreground">
                        <tr>
                            <th className="px-6 py-3">Date</th>
                            <th className="px-6 py-3">Name</th>
                            <th className="px-6 py-3">Route</th>
                            <th className="px-6 py-3">Sprints</th>
                            <th className="px-6 py-3 text-right">Results</th>
                            <th className="px-6 py-3 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {races.map(race => (
                            <tr 
                                key={race.id} 
                                className={editingRaceId === race.id 
                                    ? 'bg-primary/5' 
                                    : 'hover:bg-muted/20 transition'
                                }
                            >
                                <td className="px-6 py-4 text-card-foreground whitespace-nowrap">
                                    {new Date(race.date).toLocaleDateString()}{' '}
                                    <span className="text-muted-foreground">
                                        {new Date(race.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                </td>
                                <td className="px-6 py-4 font-medium text-card-foreground">{race.name}</td>
                                <td className="px-6 py-4 text-muted-foreground">
                                    <div className="font-medium text-card-foreground">{race.map}</div>
                                    <div className="text-xs">{race.routeName} ({race.laps} laps)</div>
                                    {race.eventMode === 'multi' ? (
                                        <div className="text-xs text-primary/70">
                                            {race.eventConfiguration?.length} Linked Events
                                        </div>
                                    ) : (
                                        race.eventId && (
                                            <div className="text-xs text-primary/70">Event ID: {race.eventId}</div>
                                        )
                                    )}
                                </td>
                                <td className="px-6 py-4 text-muted-foreground">
                                    {race.sprints 
                                        ? race.sprints.length 
                                        : (race.selectedSegments ? race.selectedSegments.length : 0)
                                    } selected
                                </td>
                                <td className="px-6 py-4 text-right space-x-2 whitespace-nowrap">
                                    {(race.eventId || (race.eventConfiguration && race.eventConfiguration.length > 0)) && (
                                        <>
                                            <button 
                                                onClick={() => onRefreshResults(race.id)}
                                                disabled={status === 'refreshing'}
                                                className="text-green-600 hover:text-green-700 dark:text-green-400 font-medium px-2 py-1"
                                            >
                                                Calc
                                            </button>
                                            <button 
                                                onClick={() => onViewResults(race.id)}
                                                className="text-blue-600 hover:text-blue-700 dark:text-blue-400 font-medium px-2 py-1"
                                            >
                                                View
                                            </button>
                                        </>
                                    )}
                                </td>
                                <td className="px-6 py-4 text-right space-x-2 whitespace-nowrap">
                                    <button 
                                        onClick={() => onEdit(race)}
                                        className="text-primary hover:text-primary/80 font-medium px-2 py-1"
                                    >
                                        Edit
                                    </button>
                                    <button 
                                        onClick={() => onDelete(race.id)}
                                        className="text-destructive hover:text-destructive/80 font-medium px-2 py-1"
                                    >
                                        Delete
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {races.length === 0 && (
                            <tr>
                                <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">
                                    No races scheduled.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
