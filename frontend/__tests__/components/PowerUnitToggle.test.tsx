import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PowerUnitToggle } from '@/app/stats/_components/PowerUnitToggle';

describe('PowerUnitToggle', () => {
    it('highlights the active unit and reports the other one', async () => {
        const onChange = vi.fn();
        render(<PowerUnitToggle value="watts" onChange={onChange} />);
        expect(screen.getByRole('group', { name: 'Effekt-enhed' })).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'W/kg' }));
        expect(onChange).toHaveBeenCalledWith('wkg');
    });
});
