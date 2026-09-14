import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

vi.mock('@/lib/firebase', () => ({ app: {}, auth: {}, db: {}, storage: {} }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/participants',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ loading: false, user: { getIdToken: async () => 'token' } }),
}));

vi.mock('@/hooks/queries', () => ({
  useParticipantsQuery: () => ({
    data: [
      {
        name: 'Ada Lovelace',
        club: 'Analytical Club',
        zwiftId: '1',
        category: '6. Division',
        zftp: 200,
        zmap: 250,
        zwiftCategory: 'C',
        rating: 400,
        max30Rating: 410,
        max90Rating: 420,
        phenotype: 'Puncheur',
        racingScore: 500,
        ligaCategory: {
          category: '6. Division',
          status: 'ok',
          upperBoundary: 500,
          graceLimit: 520,
          assignedRating: 400,
          lastCheckedRating: 410,
        },
      },
    ],
    isLoading: false,
    isError: false,
  }),
  useRacesQuery: () => ({ data: [], isLoading: false }),
  useLeagueSettingsQuery: () => ({
    data: {
      ligaCategories: [
        { name: '1. Division', upper: null, color: '#1d4ed8' },
        { name: '2. Division', upper: 900 },
        { name: '3. Division', upper: 800 },
        { name: '4. Division', upper: 700 },
        { name: '5. Division', upper: 600 },
        { name: '6. Division', upper: 500, color: '#334155' },
      ],
    },
  }),
  useRaceSignupsQuery: () => ({ data: [] }),
}));

const { default: ParticipantsPage } = await import('@/app/participants/page');

describe('Participants table layout', () => {
  it('keeps division labels on one line and scrolls inside the viewport', () => {
    render(<ParticipantsPage />);

    const table = screen.getByRole('table');
    const labels = within(table).getAllByText('6. Division');
    expect(labels.length).toBeGreaterThanOrEqual(2);
    for (const label of labels) {
      expect(label).toHaveClass('whitespace-nowrap');
    }

    expect(table).toHaveClass('min-w-max');
    expect(table.parentElement).toHaveClass('overflow-auto');
    expect(table.parentElement?.parentElement).toHaveClass('flex-1');
  });

  it('shows the ZwiftRacing gem category in ZR Kat', () => {
    render(<ParticipantsPage />);
    const table = within(screen.getByRole('table'));
    // rating 400 falls in Copper on the ZR scale, not in the league divisions.
    expect(table.getByText('Copper')).toBeInTheDocument();
    expect(table.queryByText('1. Division')).not.toBeInTheDocument();
  });

  it('orders the category columns Zwift → ZR → max30 → assigned, and bands the assigned one', () => {
    render(<ParticipantsPage />);
    const headers = within(screen.getByRole('table'))
      .getAllByRole('columnheader')
      .map((th) => th.textContent?.trim().replace(/\s+/g, ' ') ?? '');
    const katColumns = headers.filter((h) => /Kat/.test(h));
    expect(katColumns).toEqual([
      'Zwift Kat',
      'ZR Kat',
      'Liga Kat (max30)',
      'Liga Kat',
    ]);

    const ligaKatHeader = screen.getByText(/^Liga Kat$/).closest('th')!;
    expect(ligaKatHeader).toHaveClass('border-x-2', 'bg-primary/5');
    // the column band runs through the body cells too
    const ligaKatCell = within(screen.getByRole('table')).getAllByText('6. Division')[1].closest('td')!;
    expect(ligaKatCell).toHaveClass('border-x-2', 'bg-primary/5');
  });

  it('right-aligns measured values and centers the Zwift letter', () => {
    render(<ParticipantsPage />);
    const table = within(screen.getByRole('table'));

    for (const label of ['ZRS', 'vELO', 'vELO max30', 'zFTP', '20m']) {
      expect(table.getByText(new RegExp(`^${label.replace('.', '\\.')}$`)).closest('th')).toHaveClass('text-right');
    }
    // the values themselves, not just their headers
    expect(table.getByText('500').closest('td')).toHaveClass('text-right', 'font-mono');

    const zwiftKat = table.getByText('C');
    expect(zwiftKat.closest('td')).toHaveClass('text-center');
    expect(zwiftKat.closest('th')).toBeNull();

    // category pills keep their shared left edge
    expect(table.getAllByText('6. Division')[0].closest('td')).not.toHaveClass('text-center');
  });

  it('explains both liga columns on hover', () => {
    render(<ParticipantsPage />);
    expect(screen.getByText(/^Liga Kat$/).closest('th')).toHaveAttribute(
      'title',
      expect.stringContaining('rent faktisk kører i'),
    );
    expect(screen.getByText(/Liga Kat \(max30\)/).closest('th')).toHaveAttribute(
      'title',
      expect.stringContaining('max30-vELO'),
    );
    // the assigned column explains how it can be overridden
    expect(screen.getByText(/^Liga Kat$/).closest('th')?.title).toMatch(/overskrives/);
  });

  it('derives Liga Kat (max30) from the max30 rating', () => {
    render(<ParticipantsPage />);
    expect(screen.getByText(/Liga Kat \(max30\)/)).toBeInTheDocument();
    // max30Rating 410 lands in 6. Division, alongside the assigned liga category.
    expect(within(screen.getByRole('table')).getAllByText('6. Division')).toHaveLength(2);
  });

  it('paints Zwift Kat with official Zwift A–E colors', () => {
    render(<ParticipantsPage />);
    const zwiftKat = within(screen.getByRole('table')).getByText('C');
    expect(zwiftKat).toHaveStyle({ backgroundColor: 'rgb(0, 188, 212)' });
  });
});
