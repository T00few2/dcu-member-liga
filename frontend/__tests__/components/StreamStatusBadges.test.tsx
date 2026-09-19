import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StreamStatusBadges } from '@/components/shared/recording-streams/StreamStatusBadges';

describe('StreamStatusBadges', () => {
    it('keeps the 15% crop warning without claiming Zwift was left uncropped', () => {
        render(
            <StreamStatusBadges
                hasZwift
                hasStrava
                showGapOverlay={false}
                showEndGapOverlay
                gapSec={10}
                gapFraction={0.002}
                endGapSec={1320}
                endGapFraction={0.31}
                totalCropFraction={0.313}
                cropExceedsLimit
            />,
        );

        expect(screen.getByText(/exceeds the 15% limit/i)).toBeInTheDocument();
        expect(screen.queryByText(/was not cropped/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/may be distorted/i)).not.toBeInTheDocument();
    });
});
