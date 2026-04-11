'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import StravaAttribution from '@/components/StravaAttribution';
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
        selectRider, selectStravaActivity,
    } = useRiderVerification(user);

    const [selectedRaceDate, setSelectedRaceDate] = useState<number | string | null>(null);
    const [powerTrendStat, setPowerTrendStat] = useState('avg');
    const [curveTimeRange, setCurveTimeRange] = useState(90);

    const dual = useDualRecording(user, selectedRider?.zwiftId ?? null);

    const handleSelectRider = (rider: typeof participants[0]) => {
        setSelectedRaceDate(null);
        dual.reset();
        selectRider(rider);
    };

    const selectedStravaActivity = stravaData.find(a => a.id === selectedStravaActivityId);
    const formatRaceDate = (value: number | string) => {
        if (typeof value === 'number') {
            return new Date(value * 1000).toLocaleDateString();
        }
        return new Date(value).toLocaleDateString();
    };

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
                            <VerificationCharts
                                zpData={zpData}
                                selectedRaceDate={selectedRaceDate}
                                onSelectRaceDate={setSelectedRaceDate}
                                powerTrendStat={powerTrendStat}
                                onPowerTrendStatChange={setPowerTrendStat}
                                curveTimeRange={curveTimeRange}
                                onCurveTimeRangeChange={setCurveTimeRange}
                            />

                            {selectedStravaActivity && (
                                <StravaActivityDetail
                                    activity={selectedStravaActivity}
                                    streams={stravaStreams}
                                    loading={loadingStreams}
                                    onClose={() => selectStravaActivity({ ...selectedStravaActivity, id: -1 })}
                                />
                            )}

                            {/* Dual Recording Verification */}
                            <DualRecordingPanel
                                riderId={selectedRider.zwiftId}
                                zwiftActivities={dual.zwiftActivities}
                                stravaActivities={dual.stravaActivities}
                                loadingActivities={dual.loadingActivities}
                                selectedZwiftId={dual.selectedZwiftId}
                                setSelectedZwiftId={dual.setSelectedZwiftId}
                                selectedStravaId={dual.selectedStravaId}
                                setSelectedStravaId={dual.setSelectedStravaId}
                                result={dual.result}
                                loadingComparison={dual.loadingComparison}
                                error={dual.error}
                                onLoadActivities={dual.loadActivities}
                                onCompare={dual.fetchComparison}
                            />

                            {/* Data Tables */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
                                {/* Zwift Official Feed */}
                                <div className="bg-card rounded-lg shadow border border-border overflow-hidden">
                                    <div className="bg-[#FC6719]/10 p-3 border-b border-[#FC6719]/20 font-semibold text-[#FC6719] flex justify-between items-center">
                                        <span>Zwift Official Feed</span>
                                        <span className="text-xs bg-[#FC6719] text-white px-2 py-0.5 rounded-full">Last 10 Races</span>
                                    </div>
                                    <div className="divide-y divide-border max-h-[500px] overflow-y-auto">
                                        {zpData.length === 0 ? (
                                            <div className="p-6 text-center text-muted-foreground italic">No recent race data found.</div>
                                        ) : (
                                            [...zpData].reverse().slice(0, 10).map((race, idx) => {
                                                const isSelected = selectedRaceDate === race.date;
                                                return (
                                                    <div
                                                        key={idx}
                                                        onClick={() => setSelectedRaceDate(race.date)}
                                                        className={`p-4 transition cursor-pointer border-l-4 ${isSelected ? 'bg-muted/50 border-primary' : 'hover:bg-muted/30 border-transparent'}`}
                                                    >
                                                        <div className="font-medium text-sm text-card-foreground truncate mb-1">{race.event_title}</div>
                                                        <div className="text-xs text-muted-foreground mb-2">{formatRaceDate(race.date)}</div>
                                                        <div className="grid grid-cols-3 gap-2 text-center text-sm">
                                                            <div className="bg-secondary/50 rounded p-1">
                                                                <div className="text-xs text-muted-foreground">Power</div>
                                                                <div className="font-mono font-bold">{race.avg_watts}w</div>
                                                            </div>
                                                            <div className="bg-secondary/50 rounded p-1">
                                                                <div className="text-xs text-muted-foreground">W/Kg</div>
                                                                <div className="font-mono font-bold">{race.wkg.toFixed(2)}</div>
                                                            </div>
                                                            <div className="bg-secondary/50 rounded p-1">
                                                                <div className="text-xs text-muted-foreground">HR</div>
                                                                <div className={`font-mono font-bold ${race.avg_hr === 0 ? 'text-red-500' : ''}`}>
                                                                    {race.avg_hr > 0 ? race.avg_hr : 'MISSING'}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                </div>

                                {/* Strava Feed */}
                                <div className="bg-card rounded-lg shadow border border-border overflow-hidden">
                                    <div className="bg-[#FC4C02]/10 p-3 border-b border-[#FC4C02]/20 font-semibold text-[#FC4C02] flex justify-between items-center">
                                        <div className="flex flex-col">
                                            <span>Strava Feed</span>
                                            <StravaAttribution className="mt-1" />
                                        </div>
                                        <span className="text-xs bg-[#FC4C02] text-white px-2 py-0.5 rounded-full">Recent</span>
                                    </div>
                                    <div className="divide-y divide-border max-h-[500px] overflow-y-auto">
                                        {stravaData.length === 0 ? (
                                            <div className="p-6 text-center text-muted-foreground italic">
                                                No connected Strava account or activities found.
                                            </div>
                                        ) : (
                                            stravaData.map(act => {
                                                const isSelected = selectedStravaActivityId === act.id;
                                                return (
                                                    <div
                                                        key={act.id}
                                                        onClick={() => selectStravaActivity(act)}
                                                        className={`p-4 transition cursor-pointer border-l-4 ${isSelected ? 'bg-muted/50 border-[#FC4C02]' : 'hover:bg-muted/30 border-transparent'}`}
                                                    >
                                                        <div className="font-medium text-sm text-card-foreground truncate mb-1 flex justify-between items-center">
                                                            <span>{act.name}</span>
                                                            <a
                                                                href={`https://www.strava.com/activities/${act.id}`}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="text-xs text-[#FC5200] underline hover:no-underline"
                                                                onClick={e => e.stopPropagation()}
                                                            >
                                                                View on Strava
                                                            </a>
                                                        </div>
                                                        <div className="text-xs text-muted-foreground mb-2">
                                                            {new Date(act.date).toLocaleDateString()} • {(act.moving_time / 60).toFixed(0)} min
                                                        </div>
                                                        <div className="grid grid-cols-3 gap-2 text-center text-sm">
                                                            <div className="bg-secondary/50 rounded p-1">
                                                                <div className="text-xs text-muted-foreground">Avg Power</div>
                                                                <div className="font-mono">{act.average_watts ? `${act.average_watts}w` : '-'}</div>
                                                            </div>
                                                            <div className="bg-secondary/50 rounded p-1">
                                                                <div className="text-xs text-muted-foreground">Avg HR</div>
                                                                <div className="font-mono">{act.average_heartrate ? Math.round(act.average_heartrate) : '-'}</div>
                                                            </div>
                                                            <div className="bg-secondary/50 rounded p-1">
                                                                <div className="text-xs text-muted-foreground">Suffer</div>
                                                                <div className="font-mono">{act.suffer_score || '-'}</div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
