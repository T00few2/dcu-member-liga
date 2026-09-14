import type { Metadata } from 'next';
import OverlayShell from '@/components/live-race/overlay/OverlayShell';

export const metadata: Metadata = {
    robots: { index: false, follow: false },
};

export default function LiveRaceOverlayLayout({
    children,
}: Readonly<{ children: React.ReactNode }>) {
    return <OverlayShell>{children}</OverlayShell>;
}
