import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PowerCurveSection } from '@/app/stats/_components/PowerCurveSection';
import type { PowerLineStyle, RiderWithPower } from '@/app/stats/_lib/stats-types';

vi.mock('recharts', () => ({
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Line: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
}));

function rider(partial: Partial<RiderWithPower> & Pick<RiderWithPower, 'zwiftId' | 'name' | 'category'>): RiderWithPower {
    return {
        finishTime: 0,
        finishPoints: 0,
        totalPoints: 0,
        resolvedCriticalPower: {
            criticalP15Seconds: 700,
            criticalP1Minute: 400,
            criticalP5Minutes: 320,
            criticalP20Minutes: 280,
        },
        weightKg: 75,
        ...partial,
    };
}

const me = rider({ zwiftId: '1', name: 'Kim Damgaard', category: '2. Division' });
const other = rider({ zwiftId: '2', name: 'Alexander Thorsen', category: '2. Division' });
const clubmate = rider({ zwiftId: '3', name: 'Filip Klein', category: '1. Division' });

function styleFor(current: RiderWithPower): PowerLineStyle {
    const isMe = current.zwiftId === '1';
    return {
        isMe,
        isTeammate: true,
        strokeColor: '#ef4444',
        strokeWidth: isMe ? 5 : 2,
        opacity: 1,
        name: isMe ? 'Mig' : current.name,
        tooltipName: isMe ? 'Mig' : current.name,
    };
}

const chartRef = { current: null };

describe('PowerCurveSection', () => {
    it('lets the user switch between W and W/kg', async () => {
        const setPowerUnit = vi.fn();
        render(
            <PowerCurveSection
                statsMode="all"
                userCategory="2. Division"
                powerUnit="watts"
                setPowerUnit={setPowerUnit}
                powerLegendEntries={[
                    { rider: me, style: styleFor(me), isHidden: false },
                    { rider: other, style: styleFor(other), isHidden: false },
                ]}
                visibleDisplayRidersWithPower={[me, other]}
                highlightedRiderId={null}
                powerCurveChartRef={chartRef}
                getLineStyle={styleFor}
                toggleRiderVisibility={vi.fn()}
                setHighlightedRiderId={vi.fn()}
                showAllRiders={vi.fn()}
                hideAllRiders={vi.fn()}
                showOnlyMe={vi.fn()}
                exportPowerCurvePng={vi.fn()}
            />,
        );

        expect(screen.getByRole('button', { name: 'W' })).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'W/kg' }));
        expect(setPowerUnit).toHaveBeenCalledWith('wkg');
        expect(screen.getByText('Alexander Thorsen')).toBeInTheDocument();
        expect(screen.queryByText(/Kat 2\. Division/)).not.toBeInTheDocument();
        expect(screen.getByText('Mig')).toBeInTheDocument();
    });

    it('explains when W/kg cannot be plotted without rider weight', () => {
        render(
            <PowerCurveSection
                statsMode="all"
                userCategory="2. Division"
                powerUnit="wkg"
                setPowerUnit={vi.fn()}
                powerLegendEntries={[
                    { rider: { ...me, weightKg: null }, style: styleFor(me), isHidden: false },
                ]}
                visibleDisplayRidersWithPower={[{ ...me, weightKg: null }]}
                highlightedRiderId={null}
                powerCurveChartRef={chartRef}
                getLineStyle={styleFor}
                toggleRiderVisibility={vi.fn()}
                setHighlightedRiderId={vi.fn()}
                showAllRiders={vi.fn()}
                hideAllRiders={vi.fn()}
                showOnlyMe={vi.fn()}
                exportPowerCurvePng={vi.fn()}
            />,
        );

        expect(screen.getByText(/W\/kg kan ikke vises uden rytternes vægt/)).toBeInTheDocument();
    });

    it('groups club riders by category in a compact legend', () => {
        render(
            <PowerCurveSection
                statsMode="club"
                userCategory="2. Division"
                powerUnit="watts"
                setPowerUnit={vi.fn()}
                powerLegendEntries={[
                    { rider: me, style: styleFor(me), isHidden: false },
                    { rider: clubmate, style: styleFor(clubmate), isHidden: false },
                ]}
                visibleDisplayRidersWithPower={[me, clubmate]}
                highlightedRiderId={null}
                powerCurveChartRef={chartRef}
                getLineStyle={styleFor}
                toggleRiderVisibility={vi.fn()}
                setHighlightedRiderId={vi.fn()}
                showAllRiders={vi.fn()}
                hideAllRiders={vi.fn()}
                showOnlyMe={vi.fn()}
                exportPowerCurvePng={vi.fn()}
            />,
        );

        expect(screen.getByText('2. Division')).toBeInTheDocument();
        expect(screen.getByText('1. Division')).toBeInTheDocument();
        expect(screen.getByText('Filip Klein')).toBeInTheDocument();
    });
});
