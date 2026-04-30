'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRiderVerification } from '@/hooks/useRiderVerification';
import { useDualRecording } from '@/hooks/useDualRecording';
import RiderSearch from './verification/RiderSearch';
import VerificationCharts from './verification/VerificationCharts';
import StravaActivityDetail from './verification/StravaActivityDetail';
import DualRecordingPanel from './verification/DualRecordingPanel';

export default function VerificationDashboard() {
    const { user } = useAuth();
    const {
        participants, loadingList,
        selectedRider, loadingDetails,
        zpData, stravaData,
        error,
        selectedStravaActivityId, stravaStreams, loadingStreams,
        stravaPowerCurve, loadingStravaCurve, stravaCurveError,
        selectRider, selectStravaActivity, fetchStravaPowerCurve,
    } = useRiderVerification(user);

    const [powerTrendStat, setPowerTrendStat] = useState('avg');
    const [curveTimeRange, setCurveTimeRange] = useState(90);

    const dual = useDualRecording(user, selectedRider?.zwiftId ?? null);

    const handleSelectRider = (rider: typeof participants[0]) => {
        dual.reset();
        selectRider(rider);
    };

    const selectedStravaActivity = stravaData.find(a => a.id === selectedStravaActivityId);

    // Race label shown in the CP curve stat strip
    const raceCpCurve = dual.result?.zwift.cpCurve ?? null;
    const raceAvgWatts = dual.result?.zwift.avgWatts;
    const raceStartedAt = dual.result?.zwift.startedAt;
    const selectedRaceLabel = [
        raceStartedAt ? new Date(raceStartedAt).toLocaleDateString() : null,
        raceAvgWatts ? `${raceAvgWatts} W avg` : null,
    ].filter(Boolean).join(' · ') || null;

    return (
        <div className="max-w-6xl mx-auto pb-12">
            <RiderSearch
                participants={participants}
                loading={loadingList}
                onSelect={handleSelectRider}
            />

            {selectedRider && (
                <div className="space-y-8">
                    <div className="flex items-center justify-between">
                        <h2 className="text-2xl font-bold text-foreground">
                            Analysis: {selectedRider.name}
                            <span className="ml-2 text-lg font-normal text-muted-foreground">
                                (Cat {selectedRider.category})
                            </span>
                        </h2>
                        <button
                            onClick={() => selectRider(selectedRider)}
                            disabled={loadingDetails}
                            className="px-4 py-2 bg-secondary text-secondary-foreground rounded hover:opacity-90 text-sm font-medium"
                        >
                            {loadingDetails ? 'Refreshing...' : 'Refresh Data'}
                        </button>
                    </div>

                    {error && (
                        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg">{error}</div>
                    )}

                    {loadingDetails ? (
                        <div className="p-12 text-center text-muted-foreground">Fetching performance data...</div>
                    ) : (
                        <>
                            {selectedStravaActivity && (
                                <StravaActivityDetail
                                    activity={selectedStravaActivity}
                                    streams={stravaStreams}
                                    loading={loadingStreams}
                                    onClose={() => selectStravaActivity({ ...selectedStravaActivity, id: -1 })}
                                />
                            )}

                            {/*
                             * Layout order:
                             *  1. Race Performance Verification (activity selector + compare)
                             *  2. Power curve / physical profile / power trend  ← chartsSlot
                             *  3. Comparison report (inside DualRecordingPanel, after charts)
                             */}
                            <DualRecordingPanel
                                riderId={selectedRider.zwiftId}
                                hook={dual}
                            >
                                <VerificationCharts
                                    zpData={zpData}
                                    powerTrendStat={powerTrendStat}
                                    onPowerTrendStatChange={setPowerTrendStat}
                                    curveTimeRange={curveTimeRange}
                                    onCurveTimeRangeChange={setCurveTimeRange}
                                    selectedRaceCpCurve={raceCpCurve}
                                    selectedRaceLabel={selectedRaceLabel}
                                    stravaPowerCurve={stravaPowerCurve}
                                    loadingStravaCurve={loadingStravaCurve}
                                    stravaCurveError={stravaCurveError}
                                    onFetchStravaCurve={fetchStravaPowerCurve}
                                />
                            </DualRecordingPanel>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
