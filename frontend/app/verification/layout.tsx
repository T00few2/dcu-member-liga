import type { Metadata } from 'next';
import { PublicSnapshotSeed } from '@/components/public/PublicSnapshotSeed';
import { loadPublicSnapshot } from '@/lib/publicSnapshot';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
    title: 'Verifikation',
    description: 'Vægt- og udstyrsverifikation i DCU E-serien. Kravet følger den aktuelle kategori.',
    openGraph: {
        title: 'Verifikation – DCU E-serien',
        description: 'Vægt- og udstyrsverifikation i DCU E-serien. Kravet følger den aktuelle kategori.',
        url: '/verification',
    },
};

export default async function VerificationLayout({ children }: { children: React.ReactNode }) {
    const snapshot = await loadPublicSnapshot();
    return (
        <PublicSnapshotSeed settings={snapshot.settings} stageRaces={snapshot.stageRaces}>
            {children}
        </PublicSnapshotSeed>
    );
}
