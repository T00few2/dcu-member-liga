'use client';

import { Suspense } from 'react';
import { useRegistration } from '@/hooks/useRegistration';
import VerificationStatus from '@/components/register/VerificationStatus';

function VerificationContent() {
    const {
        authLoading, fetchingProfile,
        weightVerificationStatus,
        weightVerificationVideoLink,
        weightVerificationDeadline,
        verificationRequests,
        refreshProfile,
        trainer,
        trainers,
    } = useRegistration();

    if (authLoading || fetchingProfile) {
        return <div className="p-8 text-center text-muted-foreground">Indlæser...</div>;
    }

    const trainerRequiresDualRecording = !!trainers.find(t => t.name === trainer)?.dualRecordingRequired;

    return (
        <div className="max-w-2xl mx-auto mt-10 px-4 pb-16">
            <h1 className="text-3xl font-bold mb-8 text-foreground">Verifikation</h1>
            <VerificationStatus
                status={weightVerificationStatus}
                videoLink={weightVerificationVideoLink}
                deadline={weightVerificationDeadline}
                requests={verificationRequests}
                refreshProfile={refreshProfile}
                trainerRequiresDualRecording={trainerRequiresDualRecording}
            />
        </div>
    );
}

export default function VerificationPage() {
    return (
        <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Indlæser...</div>}>
            <VerificationContent />
        </Suspense>
    );
}
