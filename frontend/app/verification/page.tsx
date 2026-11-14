'use client';

import { Suspense } from 'react';
import { useRegistration } from '@/hooks/useRegistration';
import VerificationStatus from '@/components/register/VerificationStatus';
import VerificationRuleNotice from '@/components/public/VerificationRuleNotice';

function VerificationContent() {
    const {
        authLoading, fetchingProfile,
        weightVerificationStatus,
        weightVerificationDeadline,
        verificationRequests,
        dualRecordingOptIn,
        dualRecordingMethod,
        ligaCategory,
        refreshProfile,
        trainer,
        trainers,
    } = useRegistration();

    const trainerRequiresDualRecording = !!trainers.find(t => t.name === trainer)?.dualRecordingRequired;

    return (
        <div>
            {authLoading || fetchingProfile ? (
                <div className="p-8 text-center text-muted-foreground">Indlæser din status...</div>
            ) : (
            <VerificationStatus
                status={weightVerificationStatus}
                deadline={weightVerificationDeadline}
                requests={verificationRequests}
                refreshProfile={refreshProfile}
                trainerRequiresDualRecording={trainerRequiresDualRecording}
                dualRecordingOptIn={dualRecordingOptIn}
                dualRecordingMethod={dualRecordingMethod}
                ligaCategory={ligaCategory}
            />
            )}
        </div>
    );
}

export default function VerificationPage() {
    return (
        <div className="max-w-2xl mx-auto mt-10 px-4 pb-16">
            <h1 className="text-3xl font-bold mb-4 text-foreground">Verifikation</h1>
            <VerificationRuleNotice />
            <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Indlæser...</div>}>
                <VerificationContent />
            </Suspense>
        </div>
    );
}
