import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DivisionCompareSection } from '@/app/stats/_components/DivisionCompareSection';
import type { PowerUnit, RiderWithCategory } from '@/app/stats/_lib/stats-types';
import type { CriticalPower, Race } from '@/types/live';

vi.mock('recharts', () => ({
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="power-chart">{children}</div>,
    LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Line: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
}));

const power = (w15: number, w1: number, w5: number, w20: number): CriticalPower => ({
    criticalP15Seconds: w15,
    criticalP1Minute: w1,
    criticalP5Minutes: w5,
    criticalP20Minutes: w20,
});

function resultRider(
    partial: Partial<RiderWithCategory> & Pick<RiderWithCategory, 'zwiftId' | 'name' | 'category'>,
    criticalP: CriticalPower,
): RiderWithCategory {
    return {
        finishTime: 1,
        finishPoints: 0,
        totalPoints: 0,
        criticalP,
        ...partial,
    };
}

const champs = { id: '10', name: 'Champs', count: 1, key: '10_1' };
const box = { id: '99', name: 'Box Hill', count: 1, key: '99_1' };

const race: Race = {
    id: 'race-1',
    name: 'Testløb',
    date: '2026-09-17',
    eventMode: 'multi',
    eventConfiguration: [
        { eventId: 'e1', customCategory: '1. Division', sprints: [champs] },
        { eventId: 'e2', customCategory: '2. Division', sprints: [champs] },
        { eventId: 'e3', customCategory: '3. Division', sprints: [box] },
    ],
};

const riders: RiderWithCategory[] = [
    resultRider(
        {
            zwiftId: 'kim',
            name: 'Kim',
            category: '1. Division',
            sprintData: { '10_1': { time: 12000, avgPower: 750, rank: 1 } },
        },
        power(750, 600, 450, 300),
    ),
    resultRider(
        {
            zwiftId: 'bo',
            name: 'Bo',
            category: '1. Division',
            sprintData: { '10_1': { time: 14000, avgPower: 600, rank: 2 } },
        },
        power(900, 450, 300, 150),
    ),
    resultRider(
        {
            zwiftId: 'ane',
            name: 'Ane',
            category: '2. Division',
            sprintData: { '10_1': { time: 16000, avgPower: 640, rank: 1 } },
        },
        power(400, 400, 320, 400),
    ),
    resultRider(
        { zwiftId: 'ida', name: 'Ida', category: '3. Division' },
        power(350, 350, 280, 210),
    ),
];

function Harness({ initialUnit = 'wkg' }: { initialUnit?: PowerUnit }) {
    const [unit, setUnit] = useState<PowerUnit>(initialUnit);
    return (
        <DivisionCompareSection
            race={race}
            riders={riders}
            weightKgByZwiftId={{ kim: 75, bo: 75, ane: 80, ida: 70 }}
            currentUserZwiftId="kim"
            rankOrder={['1. Division', '2. Division', '3. Division']}
            powerUnit={unit}
            setPowerUnit={setUnit}
        />
    );
}

describe('DivisionCompareSection', () => {
    it('shows division medians, pins Mig, and only compares shared sprints', () => {
        render(<Harness />);

        expect(screen.getByRole('heading', { name: 'Effekt på tværs af divisioner' })).toBeInTheDocument();
        const summary = screen.getByRole('heading', { name: 'Divisionsoversigt' }).parentElement;
        expect(summary).not.toBeNull();
        const firstDivision = within(summary as HTMLElement).getByRole('row', { name: /1\. Division/ });
        expect(firstDivision).toHaveTextContent('3.00 W/kg');
        expect(firstDivision).toHaveTextContent('4.00 W/kg');
        expect(screen.getByText('3. Division kørte et andet segment.')).toBeInTheDocument();
        expect(screen.getByText('Champs #1')).toBeInTheDocument();
        expect(screen.queryByText('Box Hill #1')).not.toBeInTheDocument();

        const riderTable = screen.getByRole('heading', { name: 'Ryttere' }).closest('div');
        expect(riderTable).not.toBeNull();
        const names = within(riderTable as HTMLElement).getAllByRole('row').slice(1).map((row) => (
            within(row).getAllByRole('cell')[0].textContent
        ));
        expect(names).toEqual(['Mig (Kim)', 'Ane', 'Ida', 'Bo']);
    });

    it('keeps Mig pinned when the rider column is sorted, and division filters apply to the tables', async () => {
        const user = userEvent.setup();
        render(<Harness />);

        await user.click(screen.getByRole('button', { name: 'Rytter' }));

        const riderTable = screen.getByRole('heading', { name: 'Ryttere' }).closest('div');
        const names = within(riderTable as HTMLElement).getAllByRole('row').slice(1).map((row) => (
            within(row).getAllByRole('cell')[0].textContent
        ));
        expect(names).toEqual(['Mig (Kim)', 'Ane', 'Bo', 'Ida']);

        await user.click(screen.getByRole('checkbox', { name: '3. Division' }));

        expect(screen.queryByText('3. Division kørte et andet segment.')).not.toBeInTheDocument();
        expect(screen.queryByText('Ida')).not.toBeInTheDocument();
        expect(screen.getByText('Mig (Kim)')).toBeInTheDocument();
    });

    it('switches the same tables between W/kg and watts', async () => {
        const user = userEvent.setup();
        render(<Harness />);

        expect(screen.getAllByText('4.00 W/kg').length).toBeGreaterThan(0);
        await user.click(screen.getByRole('button', { name: 'W' }));
        expect(screen.getAllByText('300 W').length).toBeGreaterThan(0);
        expect(screen.queryByText('4.00 W/kg')).not.toBeInTheDocument();
    });
});
