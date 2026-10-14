import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/firebase', () => ({ app: {}, auth: {}, db: {}, storage: {} }));

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { getIdToken: async () => 'token' } }),
}));

const mutateAsync = vi.fn();

vi.mock('@/hooks/queries/useStreamRidersQuery', () => ({
  useStreamRidersQuery: () => ({ data: [], isFetching: false }),
  useAddStreamRiderMutation: () => ({ mutateAsync, isPending: false }),
  useRemoveStreamRiderMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const { default: StreamRidersPanel } = await import(
  '@/components/admin/league-manager/StreamRidersPanel'
);

describe('StreamRidersPanel', () => {
  it('signs riders up for every race', async () => {
    const user = userEvent.setup();
    mutateAsync.mockResolvedValue({ rider: { status: 'registered', registeredCount: 2 } });

    render(
      <StreamRidersPanel categoryOptions={['1. Division', '2. Division']} />,
    );

    expect(screen.getByRole('heading', { name: 'Stream riders' })).toBeInTheDocument();
    expect(screen.getByText(/upcoming race/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Race')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Zwift ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Public UUID')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Zwift ID'), '9990001');
    await user.type(screen.getByLabelText('Public UUID'), 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    expect(mutateAsync).toHaveBeenCalledWith({
      zwiftId: '9990001',
      publicId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      category: '1. Division',
    });
  });
});
