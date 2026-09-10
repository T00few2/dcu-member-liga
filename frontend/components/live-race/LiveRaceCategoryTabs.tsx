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
        <div className="mb-4 space-y-2" role="group" aria-label="Kategori">
            {tabsByGroup.map(({ groupName, tabs: groupTabs }) => (
                <div key={groupName ?? '__nogroup'} className="flex flex-wrap items-center gap-2">
                    {groupName && (
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground min-w-20">
                            {groupName}
                        </span>
                    )}
                    {groupTabs.map((t) => (
                        <button
                            key={`${groupName ?? ''}::${t.cat}`}
                            type="button"
                            aria-pressed={t.cat === activeCat}
                            onClick={() => onSelect(t.cat)}
                            className={`px-3 py-1.5 rounded text-sm font-semibold border ${
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
