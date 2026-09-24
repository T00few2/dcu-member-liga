import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

let pathname = '/';

vi.mock('next/navigation', () => ({
    usePathname: () => pathname,
}));

vi.mock('@/components/layout/SiteShell', () => ({
    default: ({ children }: { children: React.ReactNode }) => (
        <div data-testid="site-shell">{children}</div>
    ),
}));

vi.mock('@/components/layout/OverlayProviders', () => ({
    default: ({ children }: { children: React.ReactNode }) => (
        <div data-testid="overlay-providers">{children}</div>
    ),
}));

import AppChrome from '@/components/layout/AppChrome';

describe('AppChrome', () => {
    it('uses the full site shell on public pages', () => {
        pathname = '/schedule';
        render(<AppChrome>body</AppChrome>);
        expect(screen.getByTestId('site-shell')).toBeInTheDocument();
        expect(screen.queryByTestId('overlay-providers')).not.toBeInTheDocument();
    });

    it('skips navbar/footer/analytics providers on OBS overlay URLs', () => {
        pathname = '/live-race/overlay/profile';
        render(<AppChrome>body</AppChrome>);
        expect(screen.getByTestId('overlay-providers')).toBeInTheDocument();
        expect(screen.queryByTestId('site-shell')).not.toBeInTheDocument();
    });
});
