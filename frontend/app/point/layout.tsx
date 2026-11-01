import type { Metadata } from 'next';
import { PublicSnapshotSeed } from '@/components/public/PublicSnapshotSeed';
import { loadPublicSnapshot } from '@/lib/publicSnapshot';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
    title: 'Point',
    description: 'Pointskalaer for løb, Tour-GC og sæsonpoint i DCU E-serien.',
    openGraph: {
        title: 'Point – DCU E-serien',
        description: 'Pointskalaer for løb, Tour-GC og sæsonpoint i DCU E-serien.',
        url: '/point',
    },
};

export default async function PointLayout({ children }: { children: React.ReactNode }) {
    const snapshot = await loadPublicSnapshot();
    return (
        <PublicSnapshotSeed settings={snapshot.settings} stageRaces={snapshot.stageRaces}>
            {children}
        </PublicSnapshotSeed>
    );
}
