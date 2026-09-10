'use client';

import { categoryBadgeAppearance, type LigaCategoryDef } from '@/lib/ligaCategories';

export default function CategoryBadge({
  name,
  compact = false,
  categories,
}: {
  name: string;
  compact?: boolean;
  categories?: LigaCategoryDef[];
}) {
  const { className, style } = categoryBadgeAppearance(name, categories);
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium whitespace-nowrap ${compact ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-0.5 text-xs'} ${className}`}
      style={style}
    >
      {name}
    </span>
  );
}
