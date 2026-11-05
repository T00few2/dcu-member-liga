import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/firebase', () => ({ app: {}, auth: {}, db: {}, storage: {} }));

let params = new URLSearchParams();
const replace = vi.fn();
const router = { push: vi.fn(), replace };
vi.mock('next/navigation', () => ({
    useSearchParams: () => params,
    useRouter: () => router,
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
        params = new URLSearchParams('discord=confirm&state=abc&token=tok');
        replace.mockClear();
        localStorage.clear();
    });

    it('confirms the link with the logged-in rider token', async () => {
        const fetchMock = mockFetch({ status: 200, body: { status: 'connected', username: 'Rider' } });
        const { result } = renderHook(() => useRegistration());
        await waitFor(() => expect(result.current.discordUsername).toBe('Rider'));
        const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/discord/confirm'))!;
        const init = call[1] as RequestInit;
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer my-token');
        expect(JSON.parse(String(init.body))).toEqual({ state: 'abc', token: 'tok' });
        expect(result.current.message).toBe('Discord forbundet!');
        // The spent state and token leave the URL, so a refresh does not confirm again.
        await waitFor(() => expect(replace).toHaveBeenCalledWith('/register', { scroll: false }));
    });

    it('shows an error when the link was started by another account', async () => {
        mockFetch({ status: 403, body: { status: 'mismatch' } });
        const { result } = renderHook(() => useRegistration());
        await waitFor(() => expect(result.current.error).toMatch(/startet af en anden konto/));
        expect(result.current.discordUsername).toBeNull();
    });

    it('keeps the draft saved before an OAuth redirect', async () => {
        params = new URLSearchParams('strava=connected');
        localStorage.setItem('temp_reg_name', 'Draft Name');
        localStorage.setItem('temp_reg_club', 'Draft Club');
        mockFetch({ status: 404, body: {} });
        const { result } = renderHook(() => useRegistration());
        await waitFor(() => expect(result.current.name).toBe('Draft Name'));
        expect(localStorage.getItem('temp_reg_name')).toBe('Draft Name');
    });

    it('keeps the confirm URL for a retry when the request never reaches the server', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
        const { result } = renderHook(() => useRegistration());
        await waitFor(() => expect(result.current.error).toMatch(/Genindlæs siden/));
        expect(replace).not.toHaveBeenCalled();
    });
});
