import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ClubKitCard from '@/components/register/ClubKitCard';

describe('ClubKitCard', () => {
    it('renders kit name, image, and unlock copy', () => {
        render(
            <ClubKitCard
                dropLevel={80}
                clubKit={{
                    jerseyName: 'DZR 2025',
                    imageUrl: 'https://cdn.zwift.com/static/zc/JERSEYS/DZR2025_thumb.png',
                    notes: 'DZR club kit',
                    minLevel: 1,
                    hasLevelGrant: true,
                    showCode: false,
                    assignment: 'pinned',
                }}
            />,
        );
        expect(screen.getByText('Klubtrøje')).toBeInTheDocument();
        expect(screen.getByText('DZR 2025')).toBeInTheDocument();
        expect(screen.getByAltText('DZR 2025')).toHaveAttribute(
            'src',
            'https://cdn.zwift.com/static/zc/JERSEYS/DZR2025_thumb.png',
        );
        expect(screen.getByText('DZR club kit')).toBeInTheDocument();
        expect(screen.getByText(/Zwift-level 1/)).toBeInTheDocument();
    });
});
