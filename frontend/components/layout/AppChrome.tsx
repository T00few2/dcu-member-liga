'use client';

import { usePathname } from 'next/navigation';
import OverlayProviders from '@/components/layout/OverlayProviders';
import SiteShell from '@/components/layout/SiteShell';

export default function AppChrome({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    if (pathname?.startsWith('/live-race/overlay')) {
        return <OverlayProviders>{children}</OverlayProviders>;
    }
    return <SiteShell>{children}</SiteShell>;
}
