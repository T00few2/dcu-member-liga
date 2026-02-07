'use client';

import { useState, useEffect, useRef } from 'react';

interface Club {
    name: string;
    district: string;
    type: string;
}

interface Trainer {
    id: string;
    name: string;
    status: string;
    dualRecordingRequired: boolean;
}

interface RiderInfoFormProps {
    name: string;
    setName: (val: string) => void;
    eLicense: string;
    setELicense: (val: string) => void;
    club: string;
    setClub: (val: string) => void;
    trainer: string;
    setTrainer: (val: string) => void;
    clubs: Club[];
    loadingClubs: boolean;
    clubsError: string;
    trainers: Trainer[];
    loadingTrainers: boolean;
    trainersError: string;
    licenseAvailable: boolean;
    checkingLicense: boolean;
    checkLicense: () => void;
    licenseCheckMessage: string;
    onRequestTrainer: (name: string) => void;
    // Zwift ID Props
    zwiftId: string;
    setZwiftId: (val: string) => void;
    zwiftVerified: boolean;
    verifyingZwift: boolean;
    zwiftName: string;
    zwiftError: string;
    verifyZwiftId: () => void;
    confirmZwiftIdentity: () => void;
    readOnly?: boolean;
}

export default function RiderInfoForm({
    name, setName,
    eLicense, setELicense,
    club, setClub,
    trainer, setTrainer,
    clubs, loadingClubs, clubsError,
    trainers, loadingTrainers, trainersError,
    licenseAvailable, checkingLicense, checkLicense, licenseCheckMessage,
    onRequestTrainer,
    zwiftId, setZwiftId, zwiftVerified, verifyingZwift, zwiftName, zwiftError, verifyZwiftId, confirmZwiftIdentity,
    readOnly = false
}: RiderInfoFormProps) {
    // Club State
    const [clubSearch, setClubSearch] = useState('');
    const [showClubList, setShowClubList] = useState(false);
    const clubListRef = useRef<HTMLDivElement>(null);

    // Trainer State
    const [requestingTrainer, setRequestingTrainer] = useState(false);
    const [newTrainerName, setNewTrainerName] = useState('');

    // Update local search when prop changes (initial load or external update)
    useEffect(() => {
        if (club && club !== 'None') setClubSearch(club);
    }, [club]);

    // Close club dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (clubListRef.current && !clubListRef.current.contains(event.target as Node)) {
                setShowClubList(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleTrainerRequest = () => {
        if (!newTrainerName.trim()) return;
        onRequestTrainer(newTrainerName);
        setRequestingTrainer(false);
        setNewTrainerName('');
    };

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 gap-6">

                {/* Name */}
                <div>
                    <label className="block font-semibold text-card-foreground mb-1">Full Name</label>
                    <input
                        type="text"
                        value={name}
                        onChange={e => !readOnly && setName(e.target.value)}
                        disabled={readOnly}
                        className="w-full p-3 border border-input rounded-lg focus:ring-2 focus:ring-ring focus:border-ring outline-none transition-all text-foreground bg-background placeholder-muted-foreground disabled:opacity-50"
                        placeholder="Your Name"
                    />
                </div>

                {/* Club */}
                <div>
                    <label className="block font-semibold text-card-foreground mb-1">DCU Club</label>
                    {loadingClubs ? (
                        <p className="text-sm text-muted-foreground">Loading clubs...</p>
                    ) : clubsError ? (
                        <p className="text-sm text-red-600">{clubsError}</p>
                    ) : (
                        <div className="relative" ref={clubListRef}>
                            <input
                                type="text"
                                value={clubSearch}
                                onChange={(e) => {
                                    if (!readOnly) {
                                        setClubSearch(e.target.value);
                                        setClub(e.target.value);
                                        setShowClubList(true);
                                    }
                                }}
                                onFocus={() => !readOnly && setShowClubList(true)}
                                disabled={readOnly}
                                placeholder={readOnly ? club : "Search for your club..."}
                                className="w-full p-3 border border-input rounded-lg focus:ring-2 focus:ring-ring focus:border-ring outline-none transition-all text-foreground bg-background placeholder-muted-foreground disabled:opacity-50"
                            />

                            {showClubList && !readOnly && (
                                <div className="absolute z-10 w-full mt-1 max-h-60 overflow-y-auto bg-background border border-border rounded-lg shadow-lg">
                                    {(() => {
                                        const searchLower = clubSearch.toLowerCase();
                                        const filtered = clubs.filter(c =>
                                            c.name.toLowerCase().includes(searchLower) ||
                                            c.type.toLowerCase().includes(searchLower) ||
                                            c.district.toLowerCase().includes(searchLower)
                                        );

                                        if (filtered.length === 0 && searchLower) {
                                            return (
                                                <div className="p-2">
                                                    <div className="p-3 text-sm text-muted-foreground">No clubs found</div>
                                                    <button
                                                        onClick={() => { setClub('None'); setClubSearch('None'); setShowClubList(false); }}
                                                        className="w-full p-3 text-left hover:bg-secondary/50 border-t border-border"
                                                    >
                                                        None (No club)
                                                    </button>
                                                </div>
                                            );
                                        }

                                        return (
                                            <>
                                                {filtered.map((c, idx) => (
                                                    <button
                                                        key={idx}
                                                        onClick={() => { setClub(c.name); setClubSearch(c.name); setShowClubList(false); }}
                                                        className="w-full p-3 text-left hover:bg-secondary/50 border-b border-border last:border-b-0"
                                                    >
                                                        <div className="font-medium text-foreground">{c.name}</div>
                                                        <div className="text-xs text-muted-foreground">{c.type} • {c.district}</div>
                                                    </button>
                                                ))}
                                                <button
                                                    onClick={() => { setClub('None'); setClubSearch('None'); setShowClubList(false); }}
                                                    className="w-full p-3 text-left hover:bg-secondary/50 border-t border-border bg-secondary/20 text-foreground"
                                                >
                                                    None (No club)
                                                </button>
                                            </>
                                        );
                                    })()}
                                </div>
                            )}
                            {club && !readOnly && (
                                <button
                                    onClick={() => { setClub(''); setClubSearch(''); setShowClubList(true); }}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                    type="button"
                                >
                                    ✕
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {/* Zwift ID */}
                <div>
                    <label className="block font-semibold text-card-foreground mb-1">Zwift ID</label>
                    <p className="text-sm text-muted-foreground mb-2">
                        Find your ID at <a href="https://zwiftpower.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">ZwiftPower</a> or your profile URL settings.
                    </p>

                    <div className="flex gap-2 items-start">
                        <div className="flex-1">
                            <input
                                type="text"
                                value={zwiftId}
                                onChange={(e) => !readOnly && setZwiftId(e.target.value)}
                                className={`w-full p-3 border rounded-lg focus:ring-2 outline-none transition-all bg-background text-foreground ${zwiftVerified ? 'border-green-500 focus:ring-green-200' : zwiftError ? 'border-red-500 focus:ring-red-200' : 'border-input focus:ring-ring focus:border-ring'}`}
                                placeholder="e.g. 123456"
                                disabled={zwiftVerified || readOnly}
                            />
                            {zwiftError && <p className="text-sm text-red-500 mt-1">{zwiftError}</p>}
                        </div>

                        {zwiftVerified ? (
                            <button
                                onClick={() => !readOnly && setZwiftId('')}
                                className="px-4 py-2 bg-green-100 text-green-700 border border-green-200 rounded-lg font-bold text-sm disabled:opacity-50"
                                disabled={readOnly}
                            >
                                Verified ✓
                            </button>
                        ) : (
                            <button
                                onClick={() => !readOnly && verifyZwiftId()}
                                disabled={verifyingZwift || !zwiftId || readOnly}
                                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-bold text-sm hover:bg-primary/90 disabled:opacity-50"
                            >
                                {verifyingZwift ? '...' : 'Verify'}
                            </button>
                        )}
                    </div>

                    {/* Confirmation Prompt */}
                    {zwiftName && !zwiftVerified && !readOnly && (
                        <div className="mt-3 p-3 bg-secondary rounded-lg border border-secondary-foreground/10">
                            <p className="text-sm mb-2 text-card-foreground">Is this you? <strong>{zwiftName}</strong></p>
                            <div className="flex gap-2">
                                <button
                                    onClick={confirmZwiftIdentity}
                                    className="px-3 py-1 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700"
                                >
                                    Yes, that's me
                                </button>
                                <button
                                    onClick={() => setZwiftId('')}
                                    className="px-3 py-1 bg-gray-300 text-gray-800 rounded-lg text-sm hover:bg-gray-400"
                                >
                                    No
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* E-License */}
                <div>
                    <label className="block font-semibold text-card-foreground mb-1">DCU E-License</label>
                    <div className="relative">
                        <input
                            type="text"
                            value={eLicense}
                            onChange={e => !readOnly && setELicense(e.target.value)}
                            onBlur={() => !readOnly && checkLicense()}
                            disabled={readOnly}
                            className={`w-full p-3 border rounded-lg focus:ring-2 outline-none transition-all text-foreground bg-background disabled:opacity-50 ${!licenseAvailable ? 'border-red-500 focus:ring-red-200' :
                                (eLicense && licenseAvailable && !checkingLicense && !readOnly) ? 'border-green-500 focus:ring-green-200' :
                                    'border-input focus:ring-ring focus:border-ring'
                                }`}
                            placeholder="e.g. 10123456"
                        />
                        {checkingLicense && (
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">Checking...</span>
                        )}
                    </div>
                    {licenseCheckMessage && (
                        <p className={`text-sm mt-1 ${licenseAvailable ? 'text-green-600' : 'text-red-500'}`}>
                            {licenseCheckMessage}
                        </p>
                    )}
                </div>

                {/* Trainer */}
                <div>
                    <label className="block font-semibold text-card-foreground mb-1">Trainer / Powermeter</label>
                    {loadingTrainers ? (
                        <p className="text-sm text-muted-foreground">Loading trainers...</p>
                    ) : trainersError ? (
                        <p className="text-sm text-red-600">{trainersError}</p>
                    ) : (
                        <div className="space-y-3">
                            <select
                                value={trainer}
                                onChange={e => !readOnly && setTrainer(e.target.value)}
                                disabled={readOnly}
                                className="w-full p-3 border border-input rounded-lg focus:ring-2 focus:ring-ring focus:border-ring outline-none transition-all text-foreground bg-background disabled:opacity-50"
                            >
                                <option value="">Select trainer/powermeter</option>
                                <optgroup label="✓ Approved Trainers">
                                    {trainers.filter(t => t.status === 'approved').map((t) => (
                                        <option key={t.id} value={t.name}>
                                            {t.name} {t.dualRecordingRequired ? '(Dual Recording Required)' : ''}
                                        </option>
                                    ))}
                                </optgroup>
                                <optgroup label="✗ Not Approved" disabled>
                                    {trainers.filter(t => t.status === 'not_approved').map((t) => (
                                        <option key={t.id} value="" disabled>{t.name} - NOT APPROVED</option>
                                    ))}
                                </optgroup>
                            </select>

                            {trainer && trainers.find(t => t.name === trainer)?.dualRecordingRequired && (
                                <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                                    <p className="text-sm text-yellow-800 dark:text-yellow-200">
                                        ⚠️ <strong>Dual Recording Required:</strong> You must record verification.
                                    </p>
                                </div>
                            )}

                            {!readOnly && (
                                <button
                                    onClick={() => setRequestingTrainer(true)}
                                    className="text-sm text-primary hover:underline"
                                >
                                    Don't see your trainer? Request approval →
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {/* Request Trainer Modal */}
                {requestingTrainer && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                        <div className="bg-card p-6 rounded-lg max-w-md w-full shadow-xl border border-border">
                            <h3 className="text-lg font-bold mb-4 text-card-foreground">Request Trainer Approval</h3>
                            <p className="text-sm text-muted-foreground mb-4">
                                Please enter the full name of your trainer or powermeter. We will review it shortly.
                            </p>
                            <input
                                type="text"
                                value={newTrainerName}
                                onChange={e => setNewTrainerName(e.target.value)}
                                className="w-full p-2 border border-input rounded mb-4 bg-background text-foreground"
                                placeholder="e.g. Wahoo Kickr Core"
                            />
                            <div className="flex justify-end gap-2">
                                <button
                                    onClick={() => setRequestingTrainer(false)}
                                    className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleTrainerRequest}
                                    disabled={!newTrainerName.trim()}
                                    className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
                                >
                                    Submit Request
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
