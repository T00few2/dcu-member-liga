import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Route } from '@/types/admin';

// The hooks/queries barrel pulls in every query hook, some of which import
// lib/firebase at module load time; stub it out since this test never touches auth.
vi.mock('@/lib/firebase', () => ({ app: {}, auth: {}, db: {}, storage: {} }));

const { default: RoutePlanningTab } = await import('@/components/admin/league-manager/RoutePlanningTab');

const ROUTES: Route[] = [
    { id: 'r1', name: 'Bon Voyage', map: 'France', distance: 20, elevation: 100, leadinDistance: 1, leadinElevation: 5 },
];

function renderWithClient(ui: React.ReactElement) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

async function selectRoute(user: ReturnType<typeof userEvent.setup>) {
    const [mapSelect, routeSelect] = screen.getAllByRole('combobox');
    await user.selectOptions(mapSelect, 'France');
    await user.selectOptions(routeSelect, 'r1');
}

function getCategoryCard(name: string): HTMLElement {
    return screen.getByText(name).closest('div') as HTMLElement;
}

describe('RoutePlanningTab', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            json: async () => ({
                slug: 'bon-voyage',
                url: 'https://zwiftinsider.com/route/bon-voyage/',
                rating: 14.4,
                estimates: [
                    { wkg: 4, minutes: 43 },
                    { wkg: 3, minutes: 48 },
                    { wkg: 2, minutes: 57 },
                ],
            }),
        })));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('solves for laps that land inside the requested time span', async () => {
        const user = userEvent.setup();
        renderWithClient(<RoutePlanningTab routes={ROUTES} />);
        await selectRoute(user);

        await user.click(await screen.findByRole('button', { name: 'Target Time' }));

        // Pin Category A's W/kg to the mocked 4 W/kg tier (43min/lap) so the expected
        // lap counts below don't depend on RoutePlanningTab's default W/kg values.
        const categoryA = getCategoryCard('Category A');
        const wkgInput = within(categoryA).getByRole('spinbutton');
        await user.clear(wkgInput);
        await user.type(wkgInput, '4');

        const minInput = screen.getByLabelText('Min Hours');
        const maxInput = screen.getByLabelText('Max Hours');
        await user.clear(minInput);
        await user.type(minInput, '1.3');
        await user.clear(maxInput);
        await user.type(maxInput, '1.5');

        // 43min covers lead-in + first lap (~21km); 2 laps ~= 84min -> only 2 fits [78, 90]
        expect(within(categoryA).getByText('2')).toBeInTheDocument();
        expect(within(categoryA).queryByText('outside target span')).not.toBeInTheDocument();
    });

    it('flags when no lap count fits inside a very narrow span', async () => {
        const user = userEvent.setup();
        renderWithClient(<RoutePlanningTab routes={ROUTES} />);
        await selectRoute(user);

        await user.click(await screen.findByRole('button', { name: 'Target Time' }));

        const categoryA = getCategoryCard('Category A');
        const wkgInput = within(categoryA).getByRole('spinbutton');
        await user.clear(wkgInput);
        await user.type(wkgInput, '4');

        const minInput = screen.getByLabelText('Min Hours');
        const maxInput = screen.getByLabelText('Max Hours');
        await user.clear(minInput);
        await user.type(minInput, '1');
        await user.clear(maxInput);
        await user.type(maxInput, '1.02');

        // 43min for lead-in+lap: 1 lap = 43min, 2 laps ~= 84min, span is [60, 61.2] -> neither fits
        expect(within(categoryA).getByText('outside target span')).toBeInTheDocument();
    });

    it('keeps manual laps editable in the default mode', async () => {
        const user = userEvent.setup();
        renderWithClient(<RoutePlanningTab routes={ROUTES} />);
        await selectRoute(user);

        expect(screen.getByRole('button', { name: 'Manual Laps' })).toHaveClass('bg-primary');
        expect(screen.queryByLabelText('Min Hours')).not.toBeInTheDocument();
    });

    it('previews finish/sprint points for a category from its selected sprint segments', async () => {
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/segments')) {
                return {
                    ok: true,
                    json: async () => ({
                        segments: [{ id: 'seg1', name: 'Sprint 1', count: 1, direction: 'forward', lap: 1 }],
                    }),
                };
            }
            if (url.includes('/league/settings')) {
                return {
                    ok: true,
                    json: async () => ({
                        settings: { finishPoints: [10, 8, 6], sprintPoints: [3, 2, 1] },
                    }),
                };
            }
            return {
                ok: true,
                json: async () => ({ rating: 14.4, estimates: [] }),
            };
        }));

        const user = userEvent.setup();
        renderWithClient(<RoutePlanningTab routes={ROUTES} />);
        await selectRoute(user);

        const categoryA = getCategoryCard('Category A');
        await user.click(within(categoryA).getByText(/Sprint Segments/));
        const sprintCheckbox = await within(categoryA).findByRole('checkbox', { name: /Sprint 1/ });
        await user.click(sprintCheckbox);

        expect(within(categoryA).getByText('24')).toBeInTheDocument(); // finish: 10+8+6
        expect(within(categoryA).getByText('6')).toBeInTheDocument(); // sprint: (3+2+1) * 1 segment
        expect(within(categoryA).getByText('(1 segment)')).toBeInTheDocument();
        expect(within(categoryA).getByText('30')).toBeInTheDocument(); // combined total
    });

    it('applies a default sprint segment to every category, and removes it from every category on toggle-off', async () => {
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/segments')) {
                return {
                    ok: true,
                    json: async () => ({
                        segments: [{ id: 'seg1', name: 'Sprint 1', count: 1, direction: 'forward', lap: 1 }],
                    }),
                };
            }
            return { ok: true, json: async () => ({ rating: 14.4, estimates: [] }) };
        }));

        const user = userEvent.setup();
        renderWithClient(<RoutePlanningTab routes={ROUTES} />);
        await selectRoute(user);

        const defaultSection = screen
            .getByText('Default Sprint Segments (applies to all categories)')
            .closest('div') as HTMLElement;

        await user.click(within(defaultSection).getByRole('checkbox', { name: /Sprint 1/ }));

        for (const name of ['Category A', 'Category B', 'Category C', 'Category D']) {
            expect(within(getCategoryCard(name)).getByText('(1 segment)')).toBeInTheDocument();
        }

        await user.click(within(defaultSection).getByRole('checkbox', { name: /Sprint 1/ }));

        for (const name of ['Category A', 'Category B', 'Category C', 'Category D']) {
            expect(within(getCategoryCard(name)).getByText('(0 segments)')).toBeInTheDocument();
        }
    });
});
