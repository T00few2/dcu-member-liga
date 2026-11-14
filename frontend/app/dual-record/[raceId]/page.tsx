'use client';

import { use } from 'react';
import DualRecorderScreen from '@/components/dual-record/DualRecorderScreen';

export default function DualRecordPage({ params }: { params: Promise<{ raceId: string }> }) {
    const { raceId } = use(params);
    return <DualRecorderScreen raceId={raceId} />;
}
