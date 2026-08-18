import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The hooks/queries barrel pulls in every query hook, some of which import
// lib/firebase at module load time; stub it out since this test never touches auth.
vi.mock('@/lib/firebase', () => ({ app: {}, auth: {}, db: {}, storage: {} }));

const useAdminStatsQuery = vi.fn();
vi.mock('@/hooks/queries', () => ({ useAdminStatsQuery: () => useAdminStatsQuery() }));

const { default: StatsDashboard } = await import('@/components/admin/StatsDashboard');

const STATS = {
    total: 6,
    clubCount: 1,
    lockedCount: 0,
    selfSelectedCount: 0,
    growthSeries: [],
    registrationStatus: [{ status: 'complete', count: 6 }],
    categoryDistribution: [
        { category: 'Diamond', count: 3 },
        { category: 'Gold', count: 3 },
    ],
    clubDistribution: [],
    trainerDistribution: [
        { trainer: 'Wahoo Kickr Core', count: 3, dualRecording: 'required' as const },
        { trainer: 'Tacx Neo 2T', count: 1, dualRecording: 'notRequired' as const },
        { trainer: 'Stages Bike 20', count: 1, dualRecording: 'unknown' as const },
        { trainer: 'Unknown', count: 1, dualRecording: 'unknown' as const },
    ],
    trainerByCategory: [
        {
            category: 'Diamond',
            total: 3,
            trainers: [
                { trainer: 'Wahoo Kickr Core', count: 2, dualRecording: 'required' as const },
                { trainer: 'Tacx Neo 2T', count: 1, dualRecording: 'notRequired' as const },
            ],
        },
        {
            category: 'Gold',
            total: 3,
            trainers: [
                { trainer: 'Wahoo Kickr Core', count: 1, dualRecording: 'required' as const },
                { trainer: 'Stages Bike 20', count: 1, dualRecording: 'unknown' as const },
                { trainer: 'Unknown', count: 1, dualRecording: 'unknown' as const },
            ],
        },
    ],
    dualRecordingDistribution: [
        { bucket: 'required' as const, count: 3 },
        { bucket: 'notRequired' as const, count: 1 },
        { bucket: 'unknown' as const, count: 2 },
    ],
    dualRecordingByCategory: [
        { category: 'Diamond', required: 2, notRequired: 1, unknown: 0, total: 3 },
        { category: 'Gold', required: 1, notRequired: 0, unknown: 2, total: 3 },
    ],
    verificationStatus: [],
    phenotypeDistribution: [],
};

function card(heading: string): HTMLElement {
    return screen.getByRole('heading', { name: heading }).closest('div.bg-card') as HTMLElement;
}

/** Each dual-recording legend row renders as "<label><count><share>%". */
function expectDualRow(label: string, count: number, share: number) {
    const row = within(card('Dual Recording')).getByText(label).closest('li');
    expect(row).toHaveTextContent(`${label}${count}${share}%`);
}

describe('StatsDashboard trainer analysis', () => {
    it('shows league-wide trainer and dual-recording numbers by default', () => {
        useAdminStatsQuery.mockReturnValue({ isLoading: false, isError: false, data: STATS });
        render(<StatsDashboard />);

        const trainers = within(card('Trainer Types'));
        expect(trainers.getByText('all kategorier · 4 models')).toBeInTheDocument();
        expect(trainers.getByText('Wahoo Kickr Core')).toBeInTheDocument();

        // 3 of 6 riders need dual recording, 1 does not, 2 are unclassifiable.
        expectDualRow('Dual recording required', 3, 50);
        expectDualRow('No dual recording', 1, 17);
        expectDualRow('Unknown trainer', 2, 33);
    });

    it('keeps trainer shares correct when the API omits the dual-recording fields', () => {
        // An older /admin/stats deployment returns trainer counts only. Trainer
        // percentages must come from the trainer counts, not the dual totals.
        const { trainerByCategory, dualRecordingDistribution, dualRecordingByCategory, ...legacy } = STATS;
        const legacyStats = {
            ...legacy,
            trainerDistribution: STATS.trainerDistribution.map(({ trainer, count }) => ({ trainer, count })),
        };
        useAdminStatsQuery.mockReturnValue({ isLoading: false, isError: false, data: legacyStats });
        render(<StatsDashboard />);

        // 3 of the 6 riders ride a Wahoo Kickr Core.
        const row = within(card('Trainer Types')).getByText('Wahoo Kickr Core').closest('li');
        expect(row).toHaveTextContent('50%');

        expect(
            within(card('Dual Recording')).getByText(/Dual recording data is not in this stats response yet/)
        ).toBeInTheDocument();
    });

    it('conditions both trainer types and dual recording on the selected kategori', async () => {
        const user = userEvent.setup();
        useAdminStatsQuery.mockReturnValue({ isLoading: false, isError: false, data: STATS });
        render(<StatsDashboard />);

        await user.selectOptions(screen.getByRole('combobox'), 'Diamond');

        const trainers = within(card('Trainer Types'));
        expect(trainers.getByText('Diamond · 2 models')).toBeInTheDocument();
        expect(trainers.queryByText('Stages Bike 20')).not.toBeInTheDocument();

        expectDualRow('Dual recording required', 2, 67);
        expectDualRow('No dual recording', 1, 33);
        expectDualRow('Unknown trainer', 0, 0);
    });
});
