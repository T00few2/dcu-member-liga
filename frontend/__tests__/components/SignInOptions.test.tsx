import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let inApp = false;
vi.mock('@/lib/browser-detection', () => ({ isInAppBrowser: () => inApp }));

const { default: SignInOptions } = await import('@/components/SignInOptions');

describe('SignInOptions', () => {
    it('offers only Zwift when no Google handler is given (registration)', () => {
        inApp = false;
        render(<SignInOptions onZwift={vi.fn()} zwiftLabel="Start tilmelding med Zwift" />);
        expect(screen.getByRole('button', { name: 'Start tilmelding med Zwift' })).toBeTruthy();
        expect(screen.queryByText(/Google/)).toBeNull();
    });

    it('shows Google as a small link for riders who used it before', async () => {
        inApp = false;
        const onGoogle = vi.fn();
        render(<SignInOptions onZwift={vi.fn()} onGoogle={onGoogle} />);
        expect(screen.getByText(/Har du tidligere logget ind med Google/)).toBeTruthy();
        await userEvent.click(screen.getByRole('button', { name: 'Log ind med Google' }));
        expect(onGoogle).toHaveBeenCalled();
    });

    it('hides Google in in-app browsers', () => {
        inApp = true;
        render(<SignInOptions onZwift={vi.fn()} onGoogle={vi.fn()} />);
        expect(screen.queryByRole('button', { name: 'Log ind med Google' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Log ind med Zwift' })).toBeTruthy();
    });
});
