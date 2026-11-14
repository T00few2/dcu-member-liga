'use client';

import { useRef, useState } from 'react';

interface Props {
    onFinish: () => void;
    holdMs?: number;
}

export default function FinishHoldButton({ onFinish, holdMs = 2000 }: Props) {
    const timer = useRef<number | null>(null);
    const [holding, setHolding] = useState(false);

    const cancel = () => {
        if (timer.current != null) window.clearTimeout(timer.current);
        timer.current = null;
        setHolding(false);
    };

    return (
        <button
            type="button"
            className="w-full rounded-lg bg-red-600 py-4 text-lg font-bold text-white disabled:opacity-60"
            onPointerDown={() => {
                cancel();
                setHolding(true);
                timer.current = window.setTimeout(() => {
                    timer.current = null;
                    setHolding(false);
                    onFinish();
                }, holdMs);
            }}
            onPointerUp={cancel}
            onPointerLeave={cancel}
        >
            {holding ? 'Hold…' : 'Mål'}
        </button>
    );
}
