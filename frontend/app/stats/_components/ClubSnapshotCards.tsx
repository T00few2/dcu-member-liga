import type { ClubSnapshot } from '../_lib/stats-types';

type ClubSnapshotCardsProps = {
    snapshot: ClubSnapshot;
};

export function ClubSnapshotCards({ snapshot }: ClubSnapshotCardsProps) {
    return (
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Ryttere i klubvisning</div>
                <div className="text-2xl font-bold">{snapshot.riderCount}</div>
            </div>
            <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Gennemsnitlig rang</div>
                <div className="text-2xl font-bold">{snapshot.avgRank ? snapshot.avgRank.toFixed(1) : '-'}</div>
            </div>
            <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Bedste sprint</div>
                <div className="text-sm font-semibold">
                    {snapshot.bestSprint ? `${snapshot.bestSprint.timeSec.toFixed(2)}s` : '-'}
                </div>
                {snapshot.bestSprint && (
                    <div className="text-xs text-muted-foreground">
                        {snapshot.bestSprint.riderName} - {snapshot.bestSprint.label}
                    </div>
                )}
            </div>
            <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Bedste CP20</div>
                <div className="text-sm font-semibold">{snapshot.bestCp20 ? `${snapshot.bestCp20.watts}w` : '-'}</div>
                {snapshot.bestCp20 && <div className="text-xs text-muted-foreground">{snapshot.bestCp20.riderName}</div>}
            </div>
        </section>
    );
}
