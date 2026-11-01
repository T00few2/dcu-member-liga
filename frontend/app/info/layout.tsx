import type { Metadata } from 'next';
import { PublicSnapshotSeed } from '@/components/public/PublicSnapshotSeed';
import { loadPublicSnapshot } from '@/lib/publicSnapshot';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
    title: 'Info – Format, hold, kategorier & point',
    description: 'Alt om DCU E-seriens sæsonformat, deltagende hold, rytterkategorier og pointsystem.',
    openGraph: {
        title: 'Info – DCU E-serien',
        description: 'Alt om DCU E-seriens sæsonformat, deltagende hold, rytterkategorier og pointsystem.',
        url: '/info',
    },
};

export default async function InfoLayout({ children }: { children: React.ReactNode }) {
    const snapshot = await loadPublicSnapshot();
    return (
        <PublicSnapshotSeed settings={snapshot.settings} stageRaces={snapshot.stageRaces}>
            {children}
        </PublicSnapshotSeed>
    );
}
