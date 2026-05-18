'use client';

import { useRef, useEffect } from 'react';
import type { UserRow, SortKey, SortDir } from './types';
import { CATEGORY_STYLES, VERIFICATION_STYLES } from './types';

interface UsersTableProps {
  filtered: UserRow[];
  selectedIds: Set<string>;
  sortKey: SortKey;
  sortDir: SortDir;
  allFilteredSelected: boolean;
  someFilteredSelected: boolean;
  filteredEmpty: boolean;
  onUserSelect?: (userId: string) => void;
  onSort: (key: SortKey) => void;
  onToggleRowSelection: (rowId: string, checked: boolean) => void;
  onToggleSelectAllFiltered: () => void;
  getRowId: (row: UserRow) => string;
}

function Badge({ label, className }: { label: string; className: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

function ConnDot({ ok, title }: { ok: boolean; title: string }) {
  return (
    <span
      title={title}
      className={`inline-block w-2.5 h-2.5 rounded-full ${ok ? 'bg-green-500' : 'bg-gray-300'}`}
    />
  );
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <span className="ml-1 text-muted-foreground opacity-30">↕</span>;
  return <span className="ml-1">{dir === 'asc' ? '↑' : '↓'}</span>;
}

export default function UsersTable({
  filtered,
  selectedIds,
  sortKey,
  sortDir,
  allFilteredSelected,
  someFilteredSelected,
  filteredEmpty,
  onUserSelect,
  onSort,
  onToggleRowSelection,
  onToggleSelectAllFiltered,
  getRowId,
}: UsersTableProps) {
  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!selectAllRef.current) return;
    selectAllRef.current.indeterminate = someFilteredSelected;
  }, [someFilteredSelected]);

  const Th = ({ label, k }: { label: string; k: SortKey }) => (
    <th
      className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground cursor-pointer select-none whitespace-nowrap hover:text-foreground transition"
      onClick={() => onSort(k)}
    >
      {label}<SortIcon active={sortKey === k} dir={sortDir} />
    </th>
  );

  return (
    <div className="rounded-xl border border-border overflow-x-auto shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-muted border-b border-border">
          <tr>
            <th className="px-3 py-2.5 text-left">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allFilteredSelected}
                onChange={onToggleSelectAllFiltered}
                disabled={filteredEmpty}
                aria-label="Select all filtered users"
              />
            </th>
            <Th label="Zwift ID"   k="zwiftId" />
            <Th label="Name"       k="name" />
            <Th label="Email"      k="email" />
            <Th label="Club"       k="club" />
            <Th label="Trainer"    k="trainer" />
            <Th label="Kategori"   k="category" />
            <Th label="vELO (30d)" k="max30Rating" />
            <Th label="Phenotype"  k="phenotype" />
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">Connections</th>
            <Th label="Verification" k="verificationStatus" />
            <Th label="Signed up"  k="signedUpAt" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {filtered.length === 0 && (
            <tr>
              <td colSpan={12} className="px-4 py-8 text-center text-muted-foreground">
                No users found.
              </td>
            </tr>
          )}
          {filtered.map(row => (
            <tr
              key={getRowId(row)}
              className={`bg-card hover:bg-muted/50 transition${onUserSelect ? ' cursor-pointer' : ''}`}
              onClick={onUserSelect ? () => onUserSelect(getRowId(row)) : undefined}
            >
              <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selectedIds.has(getRowId(row))}
                  onChange={e => onToggleRowSelection(getRowId(row), e.target.checked)}
                  aria-label={`Select ${row.name}`}
                />
              </td>
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{row.zwiftId}</td>
              <td className="px-3 py-2 font-medium text-foreground whitespace-nowrap">{row.name}</td>
              <td className="px-3 py-2 text-muted-foreground text-xs">{row.email}</td>
              <td className="px-3 py-2 whitespace-nowrap">{row.club}</td>
              <td className="px-3 py-2 text-muted-foreground">{row.trainer || '—'}</td>
              <td className="px-3 py-2">
                {row.category ? (
                  <Badge
                    label={row.category}
                    className={CATEGORY_STYLES[row.category] ?? 'bg-gray-100 text-gray-700'}
                  />
                ) : <span className="text-muted-foreground">—</span>}
                {row.categoryLocked && (
                  <span className="ml-1 text-xs text-muted-foreground" title="Locked after first race">🔒</span>
                )}
              </td>
              <td className="px-3 py-2 text-right font-mono text-xs">
                {row.max30Rating !== '' && row.max30Rating !== 'N/A' ? Number(row.max30Rating).toFixed(0) : '—'}
              </td>
              <td className="px-3 py-2 text-muted-foreground capitalize">{row.phenotype || '—'}</td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <ConnDot ok={row.zwiftConnected}  title={row.zwiftConnected  ? 'Zwift connected'  : 'Zwift not connected'} />
                  <span className="text-xs text-muted-foreground">Z</span>
                  <ConnDot ok={row.stravaConnected} title={row.stravaConnected ? 'Strava connected' : 'Strava not connected'} />
                  <span className="text-xs text-muted-foreground">S</span>
                  {row.needsStravaForDR && (
                    <span
                      title="Trainer requires dual recording but Strava is not connected"
                      className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-100 text-amber-700 text-xs font-bold leading-none"
                    >
                      !
                    </span>
                  )}
                </div>
              </td>
              <td className="px-3 py-2">
                <Badge
                  label={row.verificationStatus}
                  className={VERIFICATION_STYLES[row.verificationStatus] ?? 'bg-gray-100 text-gray-600'}
                />
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                {row.signedUpAt
                  ? new Date(row.signedUpAt).toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric' })
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
