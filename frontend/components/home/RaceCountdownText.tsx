'use client';

import { useMemo } from 'react';
import { fromTimestamp } from '@/lib/formatDate';
import { formatCountdownText, useCountdown } from '@/hooks/useCountdown';

type Props = {
    date: unknown;
    className?: string;
};

export default function RaceCountdownText({ date, className }: Props) {
    const target = useMemo(() => fromTimestamp(date as never) ?? null, [date]);
    const parts = useCountdown(target);
    if (!target || parts.isPast) return null;
    return <span className={className}>{formatCountdownText(parts)}</span>;
}
