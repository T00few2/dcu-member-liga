import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import FinishHoldButton from '@/components/dual-record/FinishHoldButton';

afterEach(() => {
    vi.useRealTimers();
});

describe('FinishHoldButton', () => {
    it('finishes after a two second hold', () => {
        vi.useFakeTimers();
        const onFinish = vi.fn();
        render(<FinishHoldButton onFinish={onFinish} />);
        fireEvent.pointerDown(screen.getByRole('button', { name: 'Færdig' }));
        vi.advanceTimersByTime(1999);
        expect(onFinish).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(onFinish).toHaveBeenCalledOnce();
    });

    it('cancels when the hold is released early', () => {
        vi.useFakeTimers();
        const onFinish = vi.fn();
        render(<FinishHoldButton onFinish={onFinish} />);
        const button = screen.getByRole('button', { name: 'Færdig' });
        fireEvent.pointerDown(button);
        vi.advanceTimersByTime(500);
        fireEvent.pointerUp(button);
        vi.advanceTimersByTime(2000);
        expect(onFinish).not.toHaveBeenCalled();
    });
});
