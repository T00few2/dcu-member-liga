'use client';

import type { CategoryDef, RiderEntry } from './types';
import { getCatLower, assignedCategoryCount, countAssignedToCategory } from './utils';

interface CategoryBoundaryEditorProps {
  categories: CategoryDef[];
  riders: RiderEntry[];
  onUpdateName: (i: number, name: string) => void;
  onNameBlur?: (i: number) => void;
  onUpdateUpper: (i: number, raw: string) => void;
  onToggleVerification: (i: number, value: boolean) => void;
  onSplit: (i: number) => void;
  onMergeUp: (i: number) => void;
}

export default function CategoryBoundaryEditor({
  categories,
  riders,
  onUpdateName,
  onNameBlur,
  onUpdateUpper,
  onToggleVerification,
  onSplit,
  onMergeUp,
}: CategoryBoundaryEditorProps) {
  const assignedCount = assignedCategoryCount(riders);
  const unassignedCount = riders.length - assignedCount;
  const maxInAnyBucket = Math.max(
    1,
    ...categories.map(cat => countAssignedToCategory(riders, cat.name))
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs uppercase text-muted-foreground border-b border-border">
          <tr>
            <th className="pb-2 text-left pr-3">Name</th>
            <th className="pb-2 text-left pr-3">vELO range</th>
            <th className="pb-2 text-right pr-3 w-28">Upper boundary</th>
            <th className="pb-2 text-center pr-3" title="Weight verification + dual-recording reports">Verification</th>
            <th className="pb-2 text-left">
              Riders ({assignedCount} assigned{unassignedCount > 0 ? ` · ${unassignedCount} unassigned` : ''})
            </th>
            <th className="pb-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {categories.map((cat, i) => {
            const lower = getCatLower(categories, i);
            const upper = cat.upper;
            const count = countAssignedToCategory(riders, cat.name);
            const pct = assignedCount > 0 ? Math.round((count / assignedCount) * 100) : 0;
            const barW = Math.round((count / maxInAnyBucket) * 100);
            const isTop = i === 0;
            const canSplit = upper == null ? true : (upper - lower) >= 2;
            const canMergeUp = i > 0 && categories.length > 2;

            return (
              <tr key={i} className="hover:bg-muted/30">
                <td className="py-2 pr-3">
                  <input
                    type="text"
                    value={cat.name}
                    aria-label={`Name for category ${i + 1}`}
                    onChange={e => onUpdateName(i, e.target.value)}
                    onBlur={() => onNameBlur?.(i)}
                    className="w-28 px-2 py-1 border border-input rounded bg-background text-foreground text-sm"
                  />
                </td>
                <td className="py-2 pr-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                  {lower} – {upper != null ? upper - 1 : '∞'}
                </td>
                <td className="py-2 pr-3 text-right">
                  {isTop ? (
                    <span className="text-xs text-muted-foreground">∞ (top)</span>
                  ) : (
                    <input
                      type="number"
                      value={upper ?? ''}
                      min={lower + 1}
                      onChange={e => onUpdateUpper(i, e.target.value)}
                      className="w-24 px-2 py-1 border border-input rounded bg-background text-foreground text-sm text-right"
                    />
                  )}
                </td>
                <td className="py-2 pr-3 text-center">
                  <input
                    type="checkbox"
                    checked={cat.requiresVerification === true}
                    onChange={e => onToggleVerification(i, e.target.checked)}
                    className="h-4 w-4 accent-primary"
                    title="Include in weight verification and dual-recording reports"
                    aria-label={`Requires verification: ${cat.name}`}
                  />
                </td>
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    <div className="w-24 bg-muted rounded-full h-2 overflow-hidden flex-shrink-0">
                      <div
                        className="h-2 bg-primary rounded-full"
                        style={{ width: `${barW}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {count} ({pct}%)
                    </span>
                  </div>
                </td>
                <td className="py-2 text-right">
                  <div className="flex gap-1 justify-end">
                    {canSplit && (
                      <button
                        onClick={() => onSplit(i)}
                        className="px-2 py-1 text-xs rounded bg-muted text-muted-foreground hover:text-foreground border border-border"
                        title="Split this category at the midpoint"
                      >
                        Split
                      </button>
                    )}
                    {canMergeUp && (
                      <button
                        onClick={() => onMergeUp(i)}
                        className="px-2 py-1 text-xs rounded bg-muted text-muted-foreground hover:text-foreground border border-border"
                        title={`Merge ${cat.name} into ${categories[i - 1].name}`}
                      >
                        Merge ↑
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
