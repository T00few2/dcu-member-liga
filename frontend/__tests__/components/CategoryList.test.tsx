import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import CategoryList from '@/components/admin/category-manager/CategoryList';
import type { RiderEntry } from '@/components/admin/category-manager/types';

const ada: RiderEntry = {
  zwiftId: '1',
  name: 'Ada Lovelace',
  club: 'Analytical Club',
  currentRating: 1400,
  max30Rating: 1410,
  max90Rating: 1420,
  effectiveRating: 1410,
  ligaCategory: {
    category: 'Platinum',
    upperBoundary: 1300,
    graceLimit: 1335,
    assignedRating: 1225,
    status: 'ok',
    lastCheckedRating: 1410,
  },
};

const jonas: RiderEntry = {
  zwiftId: '2',
  name: 'Jonas Lasse Frederiksen',
  club: 'eCykle Klub Danmark',
  currentRating: 1756,
  max30Rating: 1756,
  max90Rating: 1756,
  effectiveRating: 1756,
  ligaCategory: {
    category: 'Platinum',
    upperBoundary: 1300,
    graceLimit: 1335,
    assignedRating: 1756,
    status: 'ok',
    lastCheckedRating: 1756,
    manualAssignedCategory: 'Platinum',
  },
};

function renderList(overrides: Partial<ComponentProps<typeof CategoryList>> = {}) {
  const props: ComponentProps<typeof CategoryList> = {
    riders: [ada, jonas],
    filtered: [ada, jonas],
    ridersLoading: false,
    filter: 'all',
    search: '',
    gracePeriod: 35,
    assigned: [ada, jonas],
    overCount: 0,
    graceCount: 0,
    manualCount: 1,
    onFilterChange: vi.fn(),
    onSearchChange: vi.fn(),
    onGracePeriodChange: vi.fn(),
    onRefresh: vi.fn(),
    onReassign: vi.fn(),
    onReleaseManual: vi.fn(),
    categoryOptions: ['Diamond', 'Ruby', 'Emerald', 'Platinum', 'Gold'],
    onAssignManual: vi.fn(),
    ...overrides,
  };
  return { ...render(<CategoryList {...props} />), props };
}

describe('CategoryList category dropdown', () => {
  it('shows a category select for each rider', () => {
    renderList();

    expect(screen.getByLabelText('Category for Ada Lovelace')).toHaveValue('Platinum');
    expect(screen.getByLabelText('Category for Jonas Lasse Frederiksen')).toHaveValue('Platinum');
    expect(screen.getByText('Manual category')).toBeInTheDocument();
    expect(screen.queryByText(/^Manual$/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Manual category for Ada Lovelace')).toHaveValue('');
    expect(screen.getByLabelText('Manual category for Jonas Lasse Frederiksen')).toHaveValue('Platinum');
  });

  it('assigns from the Category dropdown', async () => {
    const user = userEvent.setup();
    const onAssignManual = vi.fn();
    renderList({ onAssignManual });

    await user.selectOptions(screen.getByLabelText('Category for Ada Lovelace'), 'Gold');
    expect(onAssignManual).toHaveBeenCalledWith('1', 'Ada Lovelace', 'Gold');
  });

  it('assigns the selected manual category', async () => {
    const user = userEvent.setup();
    const onAssignManual = vi.fn();
    renderList({ onAssignManual });

    await user.selectOptions(screen.getByLabelText('Manual category for Ada Lovelace'), 'Gold');
    expect(onAssignManual).toHaveBeenCalledWith('1', 'Ada Lovelace', 'Gold');
  });

  it('releases when the empty manual option is chosen', async () => {
    const user = userEvent.setup();
    const onReleaseManual = vi.fn();
    renderList({ onReleaseManual });

    await user.selectOptions(screen.getByLabelText('Manual category for Jonas Lasse Frederiksen'), '');
    expect(onReleaseManual).toHaveBeenCalledWith('2', 'Jonas Lasse Frederiksen');
  });
});
