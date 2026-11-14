'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useDualRecord } from '@/components/dual-record/DualRecordProvider';

export default function DualRecordBar() {
    const pathname = usePathname();
    const { phase, raceId, live } = useDualRecord();
    if (phase !== 'recording' || !raceId || pathname?.startsWith('/dual-record/')) return null;
    return (
        <Link
            href={`/dual-record/${raceId}`}
            className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-between gap-3 bg-[#0e2029] px-4 py-3 text-white shadow-lg"
        >
            <span className="text-sm">Optagelse kører{live.watts != null ? ` · ${live.watts} W` : ''}</span>
            <span className="text-sm font-semibold underline">Tilbage til optagelse</span>
        </Link>
    );
}
