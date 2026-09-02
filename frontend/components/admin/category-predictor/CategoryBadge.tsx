'use client';

import { ZR_CATEGORY_STYLES } from './shared';

export default function CategoryBadge({ name, compact = false }: { name: string; compact?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${compact ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-0.5 text-xs'} ${ZR_CATEGORY_STYLES[name] ?? 'bg-slate-100 text-slate-800'}`}
    >
      {name}
    </span>
  );
}
