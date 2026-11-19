import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/firebase', () => ({ app: {}, auth: {}, db: {}, storage: {} }));
const user = { getIdToken: async () => 'tok', uid: 'zwift_1', email: null };
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user }) }));

const { default: EmailVerificationStep } = await import('@/components/register/EmailVerificationStep');

type Reply = { status: number; body: unknown };
function mockFetch(replies: Record<string, Reply>) {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
        const key = Object.keys(replies).find((k) => String(url).endsWith(k))!;
        const r = replies[key];
        return { ok: r.status < 400, status: r.status, json: async () => r.body };
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

describe('EmailVerificationStep', () => {
    beforeEach(() => vi.unstubAllGlobals());

    it('sends a code, then verifies it and reports the email', async () => {
        const fetchMock = mockFetch({
            '/profile/email/send-code': { status: 200, body: { email: 'anna@example.com', expiresInSeconds: 900 } },
            '/profile/email/verify': { status: 200, body: { email: 'anna@example.com', emailVerified: true } },
        });
        const onVerified = vi.fn();
        render(<EmailVerificationStep onVerified={onVerified} />);

        await userEvent.type(screen.getByLabelText('Email'), 'Anna@Example.com');
        await userEvent.click(screen.getByRole('button', { name: 'Send kode' }));
        expect(await screen.findByText(/Vi har sendt en kode til/)).toBeTruthy();

        const sendInit = fetchMock.mock.calls[0][1] as RequestInit;
        expect((sendInit.headers as Record<string, string>).Authorization).toBe('Bearer tok');
        expect(JSON.parse(String(sendInit.body))).toEqual({ email: 'Anna@Example.com' });

        await userEvent.type(screen.getByLabelText('Bekræftelseskode'), '12a3456');
        await userEvent.click(screen.getByRole('button', { name: 'Bekræft' }));
        await waitFor(() => expect(onVerified).toHaveBeenCalledWith('anna@example.com'));
        expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toEqual({ code: '123456' });
    });

    it('shows the server message for a wrong code', async () => {
        mockFetch({
            '/profile/email/send-code': { status: 200, body: { email: 'a@b.dk' } },
            '/profile/email/verify': { status: 400, body: { message: 'Forkert kode. 4 forsøg tilbage.', code: 'wrong_code' } },
        });
        const onVerified = vi.fn();
        render(<EmailVerificationStep initialEmail="a@b.dk" onVerified={onVerified} />);
        await userEvent.click(screen.getByRole('button', { name: 'Send kode' }));
        await userEvent.type(await screen.findByLabelText('Bekræftelseskode'), '000000');
        await userEvent.click(screen.getByRole('button', { name: 'Bekræft' }));
        expect((await screen.findByRole('alert')).textContent).toMatch(/Forkert kode/);
        expect(onVerified).not.toHaveBeenCalled();
    });

    it('shows the cooldown message when asking too soon', async () => {
        mockFetch({
            '/profile/email/send-code': { status: 429, body: { message: 'Vent 42 sekunder før du beder om en ny kode.', retryAfter: 42 } },
        });
        render(<EmailVerificationStep initialEmail="a@b.dk" onVerified={vi.fn()} />);
        await userEvent.click(screen.getByRole('button', { name: 'Send kode' }));
        expect((await screen.findByRole('alert')).textContent).toMatch(/Vent 42 sekunder/);
        expect((screen.getByRole('button', { name: 'Send kode' }) as HTMLButtonElement).disabled).toBe(true);
    });
});

describe('EmailVerificationStep – changing an existing email', () => {
    it('shows the change title and can be cancelled', async () => {
        const onCancel = vi.fn();
        render(
            <EmailVerificationStep
                title="Skift email"
                description="Den nye email gælder først, når du har bekræftet den."
                onVerified={vi.fn()}
                onCancel={onCancel}
            />,
        );
        expect(screen.getByText('Skift email')).toBeTruthy();
        expect(screen.queryByText(/Zwift deler ikke/)).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: 'Annuller' }));
        expect(onCancel).toHaveBeenCalled();
    });
});
