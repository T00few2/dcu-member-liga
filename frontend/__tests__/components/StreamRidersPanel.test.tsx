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
  it('lets you pick a race and shows sign-up fields', async () => {
    const user = userEvent.setup();
    const onRaceChange = vi.fn();

    render(
      <StreamRidersPanel
        raceId="race-1"
        raceName="Opening Race"
        categoryOptions={['1. Division', '2. Division']}
        races={[
          { id: 'race-1', name: 'Opening Race' },
          { id: 'race-2', name: 'eCKD løbet' },
        ]}
        onRaceChange={onRaceChange}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Stream riders' })).toBeInTheDocument();
    expect(screen.getByLabelText('Zwift ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Public UUID')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign up' })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Race'), 'race-2');
    expect(onRaceChange).toHaveBeenCalledWith('race-2');
  });
});
