import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import SeasonJerseyCard from '@/components/register/SeasonJerseyCard';

describe('SeasonJerseyCard', () => {
    it('shows the jersey the rider will race in', () => {
        render(
            <SeasonJerseyCard
                jersey={{
                    slot: 'kom',
                    src: 'https://cdn.example/kom.png',
                    alt: 'Bjergtrøje',
                    line: 'Du kører i bjergtrøjen.',
                }}
            />,
        );
        expect(screen.getByText('Sæsontrøje')).toBeInTheDocument();
        expect(screen.getByText('Du kører i bjergtrøjen.')).toBeInTheDocument();
        expect(screen.getByAltText('Bjergtrøje')).toHaveAttribute('src', 'https://cdn.example/kom.png');
    });
});
