'use client';

import type { LiveRaceCategoryTabGroup } from '@/lib/live-race/categoryTabs';

interface Props {
    tabsByGroup: LiveRaceCategoryTabGroup[];
    activeCat: string;
    onSelect: (cat: string) => void;
}

export default function LiveRaceCategoryTabs({ tabsByGroup, activeCat, onSelect }: Props) {
    const tabCount = tabsByGroup.reduce((n, g) => n + g.tabs.length, 0);
    if (tabCount <= 1) return null;

    return (
        <div className="mb-4 space-y-1.5 sm:space-y-2" role="group" aria-label="Kategori">
            {tabsByGroup.map(({ groupName, tabs: groupTabs }) => (
                <div key={groupName ?? '__nogroup'} className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                    {groupName && (
                        // Phones need the width for the tabs themselves; the group name
                        // stays available to screen readers.
                        <span className="sr-only sm:not-sr-only text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:min-w-20">
                            {groupName}
                        </span>
                    )}
                    {groupTabs.map((t) => (
                        <button
                            key={`${groupName ?? ''}::${t.cat}`}
                            type="button"
                            aria-pressed={t.cat === activeCat}
                            onClick={() => onSelect(t.cat)}
                            className={`px-2.5 py-1 text-xs sm:px-3 sm:py-1.5 sm:text-sm rounded font-semibold border whitespace-nowrap ${
                                t.cat === activeCat
                                    ? 'bg-primary text-primary-foreground border-primary'
                                    : 'bg-card border-border text-muted-foreground hover:border-primary/50'
                            }`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>
            ))}
        </div>
    );
}
