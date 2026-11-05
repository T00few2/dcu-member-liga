import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/firebase', () => ({ app: {}, auth: {}, db: {}, storage: {} }));

let params = new URLSearchParams();
vi.mock('next/navigation', () => ({
    useSearchParams: () => params,
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
const user = { getIdToken: async () => 'my-token', uid: 'u1', displayName: 'Me' };
vi.mock('@/lib/auth-context', () => ({
    useAuth: () => ({ user, loading: false, refreshProfile: vi.fn() }),
}));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

const { useRegistration } = await import('@/hooks/useRegistration');

function mockFetch(confirm: { status: number; body: unknown }) {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
        if (String(url).endsWith('/discord/confirm')) {
            return { ok: confirm.status < 400, status: confirm.status, json: async () => confirm.body };
        }
        return { ok: false, status: 404, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

describe('useRegistration – Discord confirm', () => {
    beforeEach(() => {
        params = new URLSearchParams('discord=confirm&state=abc');
    });

    it('confirms the link with the logged-in rider token', async () => {
        const fetchMock = mockFetch({ status: 200, body: { status: 'connected', username: 'Rider' } });
        const { result } = renderHook(() => useRegistration());
        await waitFor(() => expect(result.current.discordUsername).toBe('Rider'));
        const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/discord/confirm'))!;
        const init = call[1] as RequestInit;
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer my-token');
        expect(JSON.parse(String(init.body))).toEqual({ state: 'abc' });
        expect(result.current.message).toBe('Discord forbundet!');
    });

    it('shows an error when the link was started by another account', async () => {
        mockFetch({ status: 403, body: { status: 'mismatch' } });
        const { result } = renderHook(() => useRegistration());
        await waitFor(() => expect(result.current.error).toMatch(/startet af en anden konto/));
        expect(result.current.discordUsername).toBeNull();
    });
});
