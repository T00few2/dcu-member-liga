import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RaceSignupSelect from '@/components/RaceSignupSelect';
import type { Race } from '@/types/live';

function race(partial: Partial<Race> & Pick<Race, 'id' | 'name'>): Race {
  return {
    date: '2026-09-10T10:00:00Z',
    preRegisterAllowed: true,
    ...partial,
  } as Race;
}

describe('RaceSignupSelect', () => {
  it('lists all-participants plus signup races', () => {
    render(
      <RaceSignupSelect
        races={[
          race({ id: 'r1', name: 'Race One' }),
          race({ id: 'hidden', name: 'No signup', preRegisterAllowed: false }),
        ]}
        value=""
        onChange={vi.fn()}
        label="Signed up for"
        allLabel="All participants"
      />,
    );

    expect(screen.getByLabelText('Signed up for')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'All participants' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Race One' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'No signup' })).not.toBeInTheDocument();
  });

  it('notifies the parent when a race is chosen', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RaceSignupSelect
        races={[race({ id: 'r1', name: 'Race One' })]}
        value=""
        onChange={onChange}
        label="Signed up for"
        allLabel="All participants"
      />,
    );

    await user.selectOptions(screen.getByLabelText('Signed up for'), 'r1');
    expect(onChange).toHaveBeenCalledWith('r1');
  });
});
