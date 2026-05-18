'use client';

interface UsersFiltersProps {
  search: string;
  onSearchChange: (s: string) => void;
  filteredCount: number;
  totalCount: number;
  selectedCount: number;
  selectedFilteredCount: number;
  allFilteredSelected: boolean;
  filteredEmpty: boolean;
  onToggleSelectAllFiltered: () => void;
  onClearFilteredSelection: () => void;
  onComposeEmail: () => void;
  onRefresh: () => void;
}

export default function UsersFilters({
  search,
  onSearchChange,
  filteredCount,
  totalCount,
  selectedCount,
  selectedFilteredCount,
  allFilteredSelected,
  filteredEmpty,
  onToggleSelectAllFiltered,
  onClearFilteredSelection,
  onComposeEmail,
  onRefresh,
}: UsersFiltersProps) {
  return (
    <div className="flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="text"
          placeholder="Search name, email, club, Zwift ID…"
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          className="border border-border rounded-lg px-3 py-1.5 text-sm bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-72"
        />
        <span className="text-sm text-muted-foreground">{filteredCount} / {totalCount} riders</span>
        <span className="text-sm text-muted-foreground">{selectedCount} selected</span>
        <button
          onClick={onToggleSelectAllFiltered}
          className="text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 transition disabled:opacity-50"
          disabled={filteredEmpty}
        >
          {allFilteredSelected ? 'Deselect filtered' : 'Select all filtered'}
        </button>
        <button
          onClick={onClearFilteredSelection}
          className="text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 transition disabled:opacity-50"
          disabled={selectedFilteredCount === 0}
        >
          Clear filtered
        </button>
        <button
          onClick={onComposeEmail}
          className="text-sm bg-primary text-primary-foreground rounded-lg px-3 py-1.5 transition hover:opacity-90 disabled:opacity-50"
          disabled={selectedCount === 0}
        >
          Compose email
        </button>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onRefresh}
          className="text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 transition"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
