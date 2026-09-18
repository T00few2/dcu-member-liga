import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DualRecordingStatusBadge from '@/components/DualRecordingStatusBadge';
import type { DualRecordingVerification } from '@/types/admin';

function renderBadge(verification: DualRecordingVerification) {
    render(<DualRecordingStatusBadge verification={verification} onClick={() => undefined} />);
}

describe('DualRecordingStatusBadge source', () => {
    it('labels required dual recording as Påkrævet', () => {
        renderBadge({ status: 'failed', source: 'mandatory', failingMetrics: ['w1200'] });
        expect(screen.getByText('Påkrævet')).toBeInTheDocument();
        expect(screen.getByRole('button').getAttribute('title') || '').toMatch(/overvej DC/i);
    });

    it('labels opted-in dual recording as Frivillig', () => {
        renderBadge({ status: 'failed', source: 'opt_in', failingMetrics: ['w60'] });
        expect(screen.getByText('Frivillig')).toBeInTheDocument();
        expect(screen.getByRole('button').getAttribute('title') || '').toMatch(/ikke grundlag for DC/i);
    });
});
