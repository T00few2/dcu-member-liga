'use client';

import { useMemo } from 'react';
import { getSignupRaceOptions } from '@/lib/raceSignupOptions';
import type { Race } from '@/types/live';

interface RaceSignupSelectProps {
  races: Race[];
  value: string;
  onChange: (raceId: string) => void;
  label: string;
  allLabel: string;
}

export default function RaceSignupSelect({
  races,
  value,
  onChange,
  label,
  allLabel,
}: RaceSignupSelectProps) {
  const raceOptions = useMemo(() => getSignupRaceOptions(races), [races]);

  return (
    <label className="flex items-center gap-2 text-sm text-foreground">
      <span className="whitespace-nowrap font-medium">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-fit min-w-[12rem] px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <option value="">{allLabel}</option>
        {raceOptions.map(r => (
          <option key={r.id} value={r.id}>{r.name}</option>
        ))}
      </select>
    </label>
  );
}
