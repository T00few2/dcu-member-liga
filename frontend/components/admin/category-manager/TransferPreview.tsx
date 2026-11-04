// Dry-run preview of a mid-season category transfer (shared by the Transfer panel and the Division Agent).

type CreditRow = {
  raceId: string;
  raceName: string;
  fromCategory?: string;
  destinationFinishers: number;
  assignedPlace: number;
  leaguePoints: number;
  seasonPoints: number;
  countsNow: boolean;
};

type SkipRow = { raceId: string; raceName: string; reason: string };

type SignupRow = {
  raceId: string;
  raceName: string;
  fromSubgroupId?: string;
  toSubgroupId?: string;
  status?: string;
};

type StandingSide = { rank: number | null; points: number };

export type Preview = {
  dryRun?: boolean;
  applied?: boolean;
  message?: string;
  transferId?: string;
  fromCategory?: string;
  toCategory?: string;
  races?: CreditRow[];
  skipped?: SkipRow[];
  signups?: SignupRow[];
  penErrors?: string[];
  standings?: {
    fromCategory?: { category?: string; before?: StandingSide; after?: StandingSide };
    toCategory?: { category?: string; before?: StandingSide; after?: StandingSide };
  };
};

function standingText(side?: StandingSide): string {
  if (!side || side.rank == null) return 'not listed';
  return `#${side.rank} · ${side.points} pts`;
}

export function PreviewBlock({ preview }: { preview: Preview }) {
  const from = preview.standings?.fromCategory;
  const to = preview.standings?.toCategory;
  return (
    <div className="text-sm space-y-2 border border-border rounded p-3 bg-muted/30">
      <p>{preview.message}</p>
      {from && to && (
        <p>
          {from.category}: {standingText(from.before)} → {standingText(from.after)}. {to.category}: {standingText(to.before)} → {standingText(to.after)}.
        </p>
      )}
      {preview.races && preview.races.length > 0 && (
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1">Race</th>
              <th>Place</th>
              <th>Season pts</th>
              <th>Counts now</th>
            </tr>
          </thead>
          <tbody>
            {preview.races.map((race) => (
              <tr key={race.raceId}>
                <td className="py-1">{race.raceName}</td>
                <td>{race.assignedPlace}</td>
                <td>{race.seasonPoints}</td>
                <td>{race.countsNow ? 'yes' : 'when finalized'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {preview.skipped && preview.skipped.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Skipped: {preview.skipped.map((row) => `${row.raceName} (${row.reason})`).join(', ')}
        </p>
      )}
      {preview.signups && preview.signups.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Upcoming pens: {preview.signups.map((row) => `${row.raceName} ${row.fromSubgroupId || '—'} → ${row.toSubgroupId || 'resolved on apply'}`).join('; ')}
        </p>
      )}
      {preview.penErrors && preview.penErrors.length > 0 && (
        <p className="text-xs text-amber-700">{preview.penErrors.join(' ')}</p>
      )}
    </div>
  );
}
