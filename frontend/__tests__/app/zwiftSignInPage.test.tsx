import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('@/lib/firebase', () => ({ app: {}, auth: {}, db: {}, storage: {} }));

let params = new URLSearchParams();
const replace = vi.fn();
vi.mock('next/navigation', () => ({
    useSearchParams: () => params,
    useRouter: () => ({ replace, push: vi.fn() }),
}));

const completeZwiftSignIn = vi.fn(async () => {});
const signInWithZwift = vi.fn(async () => {});
let authState: Record<string, unknown> = {};
vi.mock('@/lib/auth-context', () => ({
    useAuth: () => ({ completeZwiftSignIn, signInWithZwift, ...authState }),
}));

const { default: ZwiftSignInPage } = await import('@/app/auth/zwift/page');

describe('/auth/zwift', () => {
    beforeEach(() => {
        replace.mockClear();
        completeZwiftSignIn.mockClear();
        authState = { user: null, loading: false, isRegistered: false, profileLoaded: false };
    });

    it('exchanges the one-time code and signs in with the custom token', async () => {
        params = new URLSearchParams('code=abc');
        const fetchMock = vi.fn(async () => ({
            ok: true, status: 200, json: async () => ({ customToken: 'ct', intent: 'register' }),
        }));
        vi.stubGlobal('fetch', fetchMock);
        render(<ZwiftSignInPage />);
        await waitFor(() => expect(completeZwiftSignIn).toHaveBeenCalledWith('ct', 'register'));
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toMatch(/\/auth\/zwift\/exchange$/);
        expect(JSON.parse(String(init.body))).toEqual({ code: 'abc' });
    });

    it('shows an error from the callback redirect without calling the backend', async () => {
        params = new URLSearchParams('error=access_denied');
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        render(<ZwiftSignInPage />);
        expect((await screen.findByRole('alert')).textContent).toMatch(/afbrød login/);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('shows an error for a used or expired code', async () => {
        params = new URLSearchParams('code=used');
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: false, status: 400, json: async () => ({ code: 'invalid_code' }),
        })));
        render(<ZwiftSignInPage />);
        expect((await screen.findByRole('alert')).textContent).toMatch(/udløbet eller allerede brugt/);
        expect(completeZwiftSignIn).not.toHaveBeenCalled();
    });
});
