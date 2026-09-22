import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StandingsTable from '@/app/results/_components/StandingsTable';

const JERSEY = 'https://cdn.zwift.com/static/zc/JERSEYS/DanishCyclingMember2019_thumb.png';

function rider(name: string, points: number) {
    return {
        zwiftId: name,
        name,
        totalPoints: points,
        raceCount: 1,
        results: [],
        calculatedTotal: points,
        countingKeys: new Set<string>(),
    };
}

function renderTable(showDivisionLeaderJersey: boolean) {
    render(
        <StandingsTable
            currentStandings={[rider('Leader', 40), rider('Tied', 40), rider('Second', 30)]}
            availableStandingsCategories={['A']}
            displayStandingsCategory="A"
            standingsCategory="A"
            setStandingsCategory={() => {}}
            showDivisionLeaderJersey={showDivisionLeaderJersey}
        />,
    );
}

describe('StandingsTable division leader jersey', () => {
    it('shows the Danish Cycling Member jersey beside riders tied for the lead', () => {
        renderTable(true);
        const images = screen.getAllByAltText('Danish Cycling Member');
        expect(images).toHaveLength(2);
        expect(images[0]).toHaveAttribute('src', JERSEY);
        const leaderHtml = screen.getByText('Leader').closest('span')?.parentElement;
        expect(leaderHtml?.className).toContain('flex-col');
        expect(leaderHtml?.className).toContain('sm:flex-row');
        const html = leaderHtml?.innerHTML ?? '';
        expect(html.indexOf('Leader')).toBeLessThan(html.indexOf('<img'));
        expect(screen.getByText('Second').parentElement?.querySelector('img')).toBeNull();
    });

    it('hides the jersey unless the season standings ask for it', () => {
        renderTable(false);
        expect(screen.queryByAltText('Danish Cycling Member')).not.toBeInTheDocument();
    });
});
