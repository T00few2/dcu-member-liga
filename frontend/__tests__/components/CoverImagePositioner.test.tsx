import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import CoverImagePositioner from '@/components/admin/CoverImagePositioner';

function renderPositioner(onChange = vi.fn()) {
    const view = render(
        <CoverImagePositioner
            src="/cover.jpg"
            position={{ x: 50, y: 50 }}
            onChange={onChange}
            onRemove={vi.fn()}
        />,
    );
    const frame = view.container.querySelector('.h-48') as HTMLDivElement;
    frame.getBoundingClientRect = () => ({
        width: 400,
        height: 200,
        top: 0,
        left: 0,
        bottom: 200,
        right: 400,
        x: 0,
        y: 0,
        toJSON() { return {}; },
    });
    const img = screen.getByAltText('Cover') as HTMLImageElement;
    Object.defineProperty(img, 'naturalWidth', { configurable: true, value: 1000 });
    Object.defineProperty(img, 'naturalHeight', { configurable: true, value: 1000 });
    fireEvent.load(img);
    return { frame, onChange };
}

describe('CoverImagePositioner', () => {
    it('slides the crop down when the photo is dragged down', () => {
        const { frame, onChange } = renderPositioner();

        fireEvent.pointerDown(frame, { pointerId: 1, clientX: 20, clientY: 20 });
        fireEvent.pointerMove(frame, { pointerId: 1, clientX: 20, clientY: 70 });

        expect(onChange).toHaveBeenCalledWith({ x: 50, y: 25 });
        expect(screen.getByAltText('Cover')).toHaveStyle({ objectPosition: '50% 50%' });
    });

    it('does not start a drag from the remove button', () => {
        const onChange = vi.fn();
        const { frame } = renderPositioner(onChange);

        fireEvent.pointerDown(screen.getByRole('button', { name: 'Fjern' }), { pointerId: 1, clientX: 0, clientY: 0 });
        fireEvent.pointerMove(frame, { pointerId: 1, clientX: 0, clientY: 80 });

        expect(onChange).not.toHaveBeenCalled();
    });
});
