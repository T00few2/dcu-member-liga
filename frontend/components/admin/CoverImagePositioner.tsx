'use client';

import { useRef } from 'react';
import {
    DEFAULT_COVER_POSITION,
    coverObjectPosition,
    panCoverByPixels,
    type CoverPosition,
} from '@/lib/coverPosition';

type Props = {
    src: string;
    position: CoverPosition;
    onChange: (next: CoverPosition) => void;
    onRemove: () => void;
};

export default function CoverImagePositioner({ src, position, onChange, onRemove }: Props) {
    const frameRef = useRef<HTMLDivElement>(null);
    const naturalRef = useRef({ w: 0, h: 0 });
    const dragRef = useRef<{ pointerId: number; x: number; y: number; pos: CoverPosition } | null>(null);

    const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if ((event.target as HTMLElement).closest('button')) return;
        const frame = frameRef.current;
        if (!frame) return;
        frame.setPointerCapture?.(event.pointerId);
        dragRef.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            pos: position,
        };
    };

    const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        const frame = frameRef.current;
        if (!drag || drag.pointerId !== event.pointerId || !frame) return;
        const rect = frame.getBoundingClientRect();
        onChange(panCoverByPixels(
            drag.pos,
            event.clientX - drag.x,
            event.clientY - drag.y,
            rect.width,
            rect.height,
            naturalRef.current.w,
            naturalRef.current.h,
        ));
    };

    const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
        if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
    };

    const rememberSize = (img: HTMLImageElement | null) => {
        if (img && img.naturalWidth > 0) {
            naturalRef.current = { w: img.naturalWidth, h: img.naturalHeight };
        }
    };

    return (
        <div className="w-full max-w-[46rem]">
            <div
                ref={frameRef}
                className="relative h-48 w-full cursor-grab touch-none select-none overflow-hidden rounded-lg border border-border active:cursor-grabbing"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
            >
                <img
                    src={src}
                    alt="Cover"
                    draggable={false}
                    ref={rememberSize}
                    onLoad={(event) => rememberSize(event.currentTarget)}
                    className="pointer-events-none h-full w-full object-cover"
                    style={{ objectPosition: coverObjectPosition(position) }}
                />
                <button
                    type="button"
                    onClick={onRemove}
                    className="absolute top-2 right-2 rounded border border-border bg-card px-2 py-1 text-xs hover:bg-muted transition-colors"
                >
                    Fjern
                </button>
            </div>
            <div className="mt-1 flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">Træk i billedet for at vælge udsnittet på nyhedskortet.</p>
                <button
                    type="button"
                    onClick={() => onChange(DEFAULT_COVER_POSITION)}
                    className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                >
                    Centrer
                </button>
            </div>
        </div>
    );
}
