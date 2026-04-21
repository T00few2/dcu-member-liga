'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { doc, updateDoc, arrayUnion, arrayRemove, collection, getDocs } from 'firebase/firestore';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';
import type { Race, RaceResult, LoadingStatus, DualRecordingVerification } from '@/types/admin';
import DualRecordingStatusBadge from '@/components/DualRecordingStatusBadge';
import DualRecordingResultModal from '@/components/DualRecordingResultModal';

interface ResultsModalProps {
    race: Race | null;
    status: LoadingStatus;
    onClose: () => void;
    onRefresh: () => void;
    onRaceUpdate: (updatedRace: Race) => void;
}

export default function ResultsModal({
    race,
    status,
    onClose,
    onRefresh,
    onRaceUpdate,
}: ResultsModalProps) {
    const { user } = useAuth();
    const [drVerifications, setDrVerifications] = useState<Map<string, DualRecordingVerification>>(new Map());
    const [drModal, setDrModal] = useState<{ name: string; verification: DualRecordingVerification } | null>(null);
    const [drRunning, setDrRunning] = useState(false);
    const [drStatus, setDrStatus] = useState<string | null>(null);

    useEffect(() => {
        if (!race) return;
        const colRef = collection(db, 'races', race.id, 'dr_verifications');
        getDocs(colRef).then(snap => {
            const map = new Map<string, DualRecordingVerification>();
            snap.forEach(d => {
                const data = d.data() as DualRecordingVerification;
                map.set(d.id, data);
            });
            setDrVerifications(map);
        }).catch(() => {});
    }, [race?.id]);

    const handleVerifyDR = async () => {
        if (!race || !user) return;
        setDrRunning(true);
        setDrStatus(null);
        try {
            const token = await user.getIdToken();
            const res = await fetch(`${API_URL}/admin/races/${race.id}/verify-dual-recording`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            });
            const body = await res.json();
            if (res.ok) {
                setDrStatus(`Trigget: ${body.triggered ?? 0} ryttere. Mangler aktivitet: ${body.missing_activity ?? 0}.`);
                // Refresh DR verifications after a short delay to let background threads finish
                setTimeout(() => {
                    const colRef = collection(db, 'races', race.id, 'dr_verifications');
                    getDocs(colRef).then(snap => {
                        const map = new Map<string, DualRecordingVerification>();
                        snap.forEach(d => map.set(d.id, d.data() as DualRecordingVerification));
                        setDrVerifications(map);
                    }).catch(() => {});
                }, 5000);
            } else {
                setDrStatus(`Fejl: ${body.message || 'Ukendt fejl'}`);
            }
        } catch {
            setDrStatus('Netværksfejl');
        } finally {
            setDrRunning(false);
        }
    };

    if (!race) return null;

    const results = race.results || {};

    // Sort categories based on event configuration order
    let categories = Object.keys(results);
    
    if (race.eventMode === 'multi' && race.eventConfiguration) {
        const orderMap = new Map();
        race.eventConfiguration.forEach((cfg, idx) => {
            if (cfg.customCategory) orderMap.set(cfg.customCategory, idx);
        });
        
        categories.sort((a, b) => {
            const idxA = orderMap.has(a) ? orderMap.get(a) : 999;
            const idxB = orderMap.has(b) ? orderMap.get(b) : 999;
            return idxA - idxB;
        });
    } else {
        categories.sort();
    }

    const handleToggleDQ = async (zwiftId: string, isCurrentlyDQ: boolean) => {
        try {
            const raceRef = doc(db, 'races', race.id);
            if (isCurrentlyDQ) {
                await updateDoc(raceRef, {
                    manualDQs: arrayRemove(zwiftId),
                });
            } else {
                await updateDoc(raceRef, {
                    manualDQs: arrayUnion(zwiftId),
                    manualDeclassifications: arrayRemove(zwiftId),
                });
            }
            
            // Update local state
            const updatedRace = {
                ...race,
                manualDQs: isCurrentlyDQ
                    ? (race.manualDQs || []).filter(id => id !== zwiftId)
                    : [...(race.manualDQs || []), zwiftId],
                manualDeclassifications: isCurrentlyDQ
                    ? race.manualDeclassifications
                    : (race.manualDeclassifications || []).filter(id => id !== zwiftId),
            };
            onRaceUpdate(updatedRace);
        } catch (e) {
            console.error("Error updating DQ status:", e);
            alert("Failed to update DQ status");
        }
    };

    const handleToggleDeclass = async (zwiftId: string, isCurrentlyDeclass: boolean) => {
        try {
            const raceRef = doc(db, 'races', race.id);
            if (isCurrentlyDeclass) {
                await updateDoc(raceRef, {
                    manualDeclassifications: arrayRemove(zwiftId),
                });
            } else {
                await updateDoc(raceRef, {
                    manualDeclassifications: arrayUnion(zwiftId),
                    manualDQs: arrayRemove(zwiftId),
                });
            }
            
            // Update local state
            const updatedRace = {
                ...race,
                manualDeclassifications: isCurrentlyDeclass
                    ? (race.manualDeclassifications || []).filter(id => id !== zwiftId)
                    : [...(race.manualDeclassifications || []), zwiftId],
                manualDQs: isCurrentlyDeclass
                    ? race.manualDQs
                    : (race.manualDQs || []).filter(id => id !== zwiftId),
            };
            onRaceUpdate(updatedRace);
        } catch (e) {
            console.error("Error updating Declass status:", e);
            alert("Failed to update Declass status");
        }
    };

    const handleToggleExclude = async (zwiftId: string, isCurrentlyExcluded: boolean) => {
        try {
            const raceRef = doc(db, 'races', race.id);
            if (isCurrentlyExcluded) {
                await updateDoc(raceRef, {
                    manualExclusions: arrayRemove(zwiftId),
                });
            } else {
                await updateDoc(raceRef, {
                    manualExclusions: arrayUnion(zwiftId),
                    manualDQs: arrayRemove(zwiftId),
                    manualDeclassifications: arrayRemove(zwiftId),
                });
            }
            
            // Update local state
            const updatedRace = {
                ...race,
                manualExclusions: isCurrentlyExcluded
                    ? (race.manualExclusions || []).filter(id => id !== zwiftId)
                    : [...(race.manualExclusions || []), zwiftId],
                manualDQs: isCurrentlyExcluded
                    ? race.manualDQs
                    : (race.manualDQs || []).filter(id => id !== zwiftId),
                manualDeclassifications: isCurrentlyExcluded
                    ? race.manualDeclassifications
                    : (race.manualDeclassifications || []).filter(id => id !== zwiftId),
            };
            onRaceUpdate(updatedRace);
        } catch (e) {
            console.error("Error updating exclusion status:", e);
            alert("Failed to update exclusion status");
        }
    };

    return (
        <>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-card w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-lg shadow-2xl border border-border flex flex-col">
                <div className="p-4 border-b border-border flex justify-between items-center bg-muted/30">
                    <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="text-lg font-bold text-card-foreground">
                            Results: {race.name}
                        </h3>
                        <button
                            onClick={onRefresh}
                            disabled={status === 'refreshing'}
                            className="text-xs bg-primary text-primary-foreground px-3 py-1 rounded hover:opacity-90 font-medium"
                        >
                            {status === 'refreshing' ? 'Calculating...' : 'Recalculate Results'}
                        </button>
                        <button
                            onClick={handleVerifyDR}
                            disabled={drRunning}
                            title="Kør dual recording verifikation for DR-krævede ryttere"
                            className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:opacity-90 font-medium disabled:opacity-50"
                        >
                            {drRunning ? 'Verificerer DR...' : 'Verificer DR'}
                        </button>
                        {drStatus && (
                            <span className="text-xs text-muted-foreground">{drStatus}</span>
                        )}
                    </div>
                    <button 
                        onClick={onClose}
                        className="text-muted-foreground hover:text-foreground p-1"
                    >
                        ✕
                    </button>
                </div>
                
                <div className="overflow-y-auto p-4 space-y-6">
                    {categories.length === 0 ? (
                        <div className="text-center text-muted-foreground p-8">
                            No results calculated yet.
                        </div>
                    ) : (
                        <>
                            {/* Excluded Riders Section */}
                            {(race.manualExclusions || []).length > 0 && (
                                <div className="border border-border rounded-lg p-3 bg-muted/20 text-xs">
                                    <div className="font-semibold text-muted-foreground mb-2">Excluded Riders</div>
                                    <div className="flex flex-wrap gap-2">
                                        {(race.manualExclusions || []).map((zid: string) => (
                                            <button
                                                key={zid}
                                                onClick={() => handleToggleExclude(zid, true)}
                                                className="px-2 py-1 rounded border border-border bg-background hover:bg-muted/50 text-muted-foreground"
                                                title="Remove exclusion"
                                            >
                                                {zid} ×
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Results by Category */}
                            {categories.map(cat => (
                                <CategoryResultsTable
                                    key={cat}
                                    category={cat}
                                    results={results[cat] as RaceResult[]}
                                    manualDQs={race.manualDQs || []}
                                    manualDeclassifications={race.manualDeclassifications || []}
                                    manualExclusions={race.manualExclusions || []}
                                    drVerifications={drVerifications}
                                    onToggleDQ={handleToggleDQ}
                                    onToggleDeclass={handleToggleDeclass}
                                    onToggleExclude={handleToggleExclude}
                                    onOpenDR={(name, v) => setDrModal({ name, verification: v })}
                                />
                            ))}
                        </>
                    )}
                </div>
            </div>
        </div>
        {drModal && (
            <DualRecordingResultModal
                open
                onClose={() => setDrModal(null)}
                riderName={drModal.name}
                verification={drModal.verification}
            />
        )}
    </>
    );
}

// Sub-component for category results table
interface CategoryResultsTableProps {
    category: string;
    results: RaceResult[];
    manualDQs: string[];
    manualDeclassifications: string[];
    manualExclusions: string[];
    drVerifications: Map<string, DualRecordingVerification>;
    onToggleDQ: (zwiftId: string, isCurrentlyDQ: boolean) => void;
    onToggleDeclass: (zwiftId: string, isCurrentlyDeclass: boolean) => void;
    onToggleExclude: (zwiftId: string, isCurrentlyExcluded: boolean) => void;
    onOpenDR: (riderName: string, v: DualRecordingVerification) => void;
}

function CategoryResultsTable({
    category,
    results,
    manualDQs,
    manualDeclassifications,
    manualExclusions,
    drVerifications,
    onToggleDQ,
    onToggleDeclass,
    onToggleExclude,
    onOpenDR,
}: CategoryResultsTableProps) {
    return (
        <div className="border border-border rounded-lg overflow-hidden">
            <div className="bg-secondary/50 px-4 py-2 font-semibold text-sm border-b border-border">
                {category}
            </div>
            <table className="w-full text-left text-sm">
                <thead className="bg-muted/20 text-xs text-muted-foreground">
                    <tr>
                        <th className="px-4 py-2 w-12">Pos</th>
                        <th className="px-4 py-2">Rider</th>
                        <th className="px-4 py-2 text-right">Time</th>
                        <th className="px-4 py-2 text-right">Pts</th>
                        <th className="px-4 py-2 text-center w-20">Flags</th>
                        <th className="px-4 py-2 text-center w-12" title="Disqualify (0 pts)">DQ</th>
                        <th className="px-4 py-2 text-center w-12" title="Declassify (Last place pts)">DC</th>
                        <th className="px-4 py-2 text-center w-12" title="Exclude from results">EX</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-border">
                    {results.map((rider, idx) => {
                        const isFlagged = rider.flaggedCheating || rider.flaggedSandbagging;
                        const isManualDQ = manualDQs.includes(rider.zwiftId);
                        const isManualDeclass = manualDeclassifications.includes(rider.zwiftId);
                        const isManualExcluded = manualExclusions.includes(rider.zwiftId);
                        
                        let rowClass = 'hover:bg-muted/10';
                        if (isManualExcluded) {
                            rowClass += ' bg-slate-50 dark:bg-slate-900/30';
                        } else if (isFlagged || isManualDQ) {
                            rowClass += ' bg-red-50 dark:bg-red-950/20';
                        } else if (isManualDeclass) {
                            rowClass += ' bg-yellow-50 dark:bg-yellow-950/20';
                        }

                        return (
                            <tr key={rider.zwiftId} className={rowClass}>
                                <td className="px-4 py-2 text-muted-foreground">
                                    {isManualExcluded ? '×' : isManualDQ ? '-' : isManualDeclass ? '*' : idx + 1}
                                </td>
                                <td className="px-4 py-2 font-medium">
                                    {rider.name}
                                    {isFlagged && (
                                        <div className="text-[10px] text-red-600 font-bold mt-0.5">
                                            {rider.flaggedCheating ? 'CHEATING ' : ''}
                                            {rider.flaggedSandbagging ? 'SANDBAGGING' : ''}
                                        </div>
                                    )}
                                    {isManualExcluded && (
                                        <div className="text-[10px] text-slate-600 font-bold mt-0.5">EXCLUDED</div>
                                    )}
                                    {isManualDQ && (
                                        <div className="text-[10px] text-red-600 font-bold mt-0.5">DISQUALIFIED</div>
                                    )}
                                    {isManualDeclass && (
                                        <div className="text-[10px] text-yellow-600 font-bold mt-0.5">DECLASSIFIED</div>
                                    )}
                                </td>
                                <td className="px-4 py-2 text-right font-mono text-muted-foreground">
                                    {rider.finishTime > 0 
                                        ? new Date(rider.finishTime).toISOString().substr(11, 8) 
                                        : '-'
                                    }
                                </td>
                                <td className="px-4 py-2 text-right font-bold text-primary">
                                    {rider.totalPoints}
                                    {(isManualExcluded || (isManualDQ && rider.totalPoints > 0) || (isManualDeclass && rider.totalPoints === 0)) && (
                                        <span className="text-[10px] text-red-500 block" title="Recalculation needed">
                                            (Recalc)
                                        </span>
                                    )}
                                </td>
                                <td className="px-4 py-2 text-center">
                                    <div className="flex items-center justify-center gap-1">
                                        {isFlagged && <span className="text-xl" title="Flagged">🚩</span>}
                                        {drVerifications.has(rider.zwiftId) && (
                                            <DualRecordingStatusBadge
                                                verification={drVerifications.get(rider.zwiftId)}
                                                onClick={() => onOpenDR(rider.name, drVerifications.get(rider.zwiftId)!)}
                                            />
                                        )}
                                    </div>
                                </td>
                                <td className="px-4 py-2 text-center">
                                    <input 
                                        type="checkbox"
                                        checked={isManualDQ}
                                        onChange={() => onToggleDQ(rider.zwiftId, isManualDQ)}
                                        disabled={isManualDeclass || isManualExcluded}
                                        title={isManualExcluded ? "Excluded from results" : isManualDeclass ? "Uncheck Declassify first" : "Disqualify"}
                                        className="w-4 h-4 rounded border-input text-primary focus:ring-primary cursor-pointer disabled:opacity-30"
                                    />
                                </td>
                                <td className="px-4 py-2 text-center">
                                    <input 
                                        type="checkbox"
                                        checked={isManualDeclass}
                                        onChange={() => onToggleDeclass(rider.zwiftId, isManualDeclass)}
                                        disabled={isManualDQ || isManualExcluded}
                                        title={isManualExcluded ? "Excluded from results" : isManualDQ ? "Uncheck DQ first" : "Declassify"}
                                        className="w-4 h-4 rounded border-input text-yellow-500 focus:ring-yellow-500 cursor-pointer disabled:opacity-30"
                                    />
                                </td>
                                <td className="px-4 py-2 text-center">
                                    <input 
                                        type="checkbox"
                                        checked={isManualExcluded}
                                        onChange={() => onToggleExclude(rider.zwiftId, isManualExcluded)}
                                        title={isManualExcluded ? "Include in results" : "Exclude from results"}
                                        className="w-4 h-4 rounded border-input text-slate-600 focus:ring-slate-500 cursor-pointer"
                                    />
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
