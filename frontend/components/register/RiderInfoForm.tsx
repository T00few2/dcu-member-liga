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
    club, setClub,
    trainer, setTrainer,
    clubs, loadingClubs, clubsError,
    trainers, loadingTrainers, trainersError,
    onRequestTrainer,
    zwiftId, setZwiftId, zwiftVerified, verifyingZwift, zwiftName, zwiftError, verifyZwiftId, confirmZwiftIdentity,
    readOnly = false
}: RiderInfoFormProps) {
    // Club State
    const [clubSearch, setClubSearch] = useState('');
    const [showClubList, setShowClubList] = useState(false);
    const [isDropdownOpenedWithoutTyping, setIsDropdownOpenedWithoutTyping] = useState(false);
    const [focusedClubIndex, setFocusedClubIndex] = useState(-1);
    const clubListRef = useRef<HTMLDivElement>(null);
    const clubInputRef = useRef<HTMLInputElement>(null);

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

    const handleClubKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, filteredClubs: Club[], selectClub: (c: Club | null) => void) => {
        if (!showClubList) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setFocusedClubIndex(i => Math.min(i + 1, filteredClubs.length)); // +1 for "Ingen" option
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setFocusedClubIndex(i => Math.max(i - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (focusedClubIndex >= 0 && focusedClubIndex < filteredClubs.length) {
                selectClub(filteredClubs[focusedClubIndex]);
            } else if (focusedClubIndex === filteredClubs.length) {
                selectClub(null); // "Ingen"
            }
        } else if (e.key === 'Escape') {
            setShowClubList(false);
            setFocusedClubIndex(-1);
        }
    };

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
                    <label className="block font-semibold text-card-foreground mb-1">Fulde navn</label>
                    <input
                        type="text"
                        value={name}
                        onChange={e => !readOnly && setName(e.target.value)}
                        disabled={readOnly}
                        className="w-full p-3 border border-input rounded-lg focus:ring-2 focus:ring-ring focus:border-ring outline-none transition-all text-foreground bg-background placeholder-muted-foreground disabled:opacity-50"
                        placeholder="Dit navn"
                    />
                </div>

                {/* Club */}
                <div>
                    <label className="block font-semibold text-card-foreground mb-1">DCU Klub</label>
                    {loadingClubs ? (
                        <p className="text-sm text-muted-foreground">Indlæser klubber...</p>
                    ) : clubsError ? (
                        <p className="text-sm text-red-600">{clubsError}</p>
                    ) : (
                        <div className="relative" ref={clubListRef}>
                            {(() => {
                                const searchLower = clubSearch.toLowerCase();
                                const filteredClubs = isDropdownOpenedWithoutTyping ? clubs : clubs.filter(c =>
                                    c.name.toLowerCase().includes(searchLower) ||
                                    c.type.toLowerCase().includes(searchLower) ||
                                    c.district.toLowerCase().includes(searchLower)
                                );
                                const selectClub = (c: Club | null) => {
                                    if (c) { setClub(c.name); setClubSearch(c.name); }
                                    else { setClub('None'); setClubSearch('None'); }
                                    setShowClubList(false);
                                    setIsDropdownOpenedWithoutTyping(false);
                                    setFocusedClubIndex(-1);
                                };
                                return (
                                    <>
                                        <input
                                            ref={clubInputRef}
                                            type="text"
                                            value={clubSearch}
                                            onChange={(e) => {
                                                if (!readOnly) {
                                                    setIsDropdownOpenedWithoutTyping(false);
                                                    setClubSearch(e.target.value);
                                                    setClub(e.target.value);
                                                    setShowClubList(true);
                                                    setFocusedClubIndex(-1);
                                                }
                                            }}
                                            onFocus={(e) => {
                                                if (!readOnly) {
                                                    e.target.select();
                                                    setIsDropdownOpenedWithoutTyping(true);
                                                    setShowClubList(true);
                                                }
                                            }}
                                            onKeyDown={(e) => !readOnly && handleClubKeyDown(e, filteredClubs, selectClub)}
                                            disabled={readOnly}
                                            placeholder={readOnly ? club : "Søg efter din klub..."}
                                            className="w-full p-3 border border-input rounded-lg focus:ring-2 focus:ring-ring focus:border-ring outline-none transition-all text-foreground bg-background placeholder-muted-foreground disabled:opacity-50"
                                            aria-autocomplete="list"
                                            aria-expanded={showClubList}
                                            role="combobox"
                                        />

                                        {showClubList && !readOnly && (
                                            <div className="absolute z-10 w-full mt-1 max-h-60 overflow-y-auto bg-background border border-border rounded-lg shadow-lg" role="listbox">
                                                {filteredClubs.length === 0 && searchLower ? (
                                                    <div className="p-2">
                                                        <div className="p-3 text-sm text-muted-foreground">Ingen klubber fundet</div>
                                                        <button
                                                            onClick={() => selectClub(null)}
                                                            className={`w-full p-3 text-left border-t border-border ${focusedClubIndex === 0 ? 'bg-secondary/70' : 'hover:bg-secondary/50'}`}
                                                            role="option"
                                                        >
                                                            Ingen (Ingen klub)
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <>
                                                        {filteredClubs.map((c, idx) => (
                                                            <button
                                                                key={idx}
                                                                onClick={() => selectClub(c)}
                                                                className={`w-full p-3 text-left border-b border-border last:border-b-0 ${focusedClubIndex === idx ? 'bg-secondary/70' : 'hover:bg-secondary/50'}`}
                                                                role="option"
                                                                aria-selected={focusedClubIndex === idx}
                                                            >
                                                                <div className="font-medium text-foreground">{c.name}</div>
                                                                <div className="text-xs text-muted-foreground">{c.type} • {c.district}</div>
                                                            </button>
                                                        ))}
                                                        <button
                                                            onClick={() => selectClub(null)}
                                                            className={`w-full p-3 text-left border-t border-border bg-secondary/20 text-foreground ${focusedClubIndex === filteredClubs.length ? 'bg-secondary/70' : 'hover:bg-secondary/50'}`}
                                                            role="option"
                                                            aria-selected={focusedClubIndex === filteredClubs.length}
                                                        >
                                                            Ingen (Ingen klub)
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        )}
                                    </>
                                );
                            })()}

                            {club && !readOnly && (
                                <button
                                    onClick={() => { setClub(''); setClubSearch(''); setShowClubList(true); setIsDropdownOpenedWithoutTyping(true); setFocusedClubIndex(-1); clubInputRef.current?.focus(); }}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                    type="button"
                                    aria-label="Ryd klub"
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
                        Forbind Zwift i fanen “Forbindelser” og bekræft derefter, at ID matcher din tilknyttede Zwift konto.
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
                                Bekræftet ✓
                            </button>
                        ) : (
                            <button
                                onClick={() => !readOnly && verifyZwiftId()}
                                disabled={verifyingZwift || !zwiftId || readOnly}
                                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-bold text-sm hover:bg-primary-dark disabled:opacity-50"
                            >
                                {verifyingZwift ? '...' : 'Bekræft'}
                            </button>
                        )}
                    </div>

                    {/* Confirmation Prompt */}
                    {zwiftName && !zwiftVerified && !readOnly && (
                        <div className="mt-3 p-4 bg-muted/30 rounded-lg border border-border">
                            <p className="text-sm mb-3 text-foreground">
                                Er det dig? <strong className="font-semibold">{zwiftName}</strong>
                            </p>
                            <div className="flex gap-2">
                                <button
                                    onClick={confirmZwiftIdentity}
                                    className="px-4 py-2 bg-primary text-primary-foreground font-medium rounded-lg text-sm hover:bg-primary-dark transition-colors"
                                >
                                    Ja, det er mig
                                </button>
                                <button
                                    onClick={() => setZwiftId('')}
                                    className="px-4 py-2 bg-secondary text-secondary-foreground font-medium rounded-lg text-sm hover:bg-secondary/80 transition-colors"
                                >
                                    Nej
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Trainer */}
                <div>
                    <label className="block font-semibold text-card-foreground mb-1">Hometrainer / Wattmåler</label>
                    {loadingTrainers ? (
                        <p className="text-sm text-muted-foreground">Indlæser hometrainere...</p>
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
                                <option value="">Vælg hometrainer/wattmåler</option>
                                <optgroup label="✓ Godkendte hometrainere">
                                    {trainers.filter(t => t.status === 'approved').map((t) => (
                                        <option key={t.id} value={t.name}>
                                            {t.name} {t.dualRecordingRequired ? '(Dual Recording påkrævet)' : ''}
                                        </option>
                                    ))}
                                </optgroup>
                                <optgroup label="✗ Ikke godkendt" disabled>
                                    {trainers.filter(t => t.status === 'not_approved').map((t) => (
                                        <option key={t.id} value="" disabled>{t.name} - IKKE GODKENDT</option>
                                    ))}
                                </optgroup>
                            </select>

                            {trainer && trainers.find(t => t.name === trainer)?.dualRecordingRequired && (
                                <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                                    <p className="text-sm text-yellow-800 dark:text-yellow-200">
                                        ⚠️ <strong>Dual Recording påkrævet:</strong> Du skal optage bekræftelsesvideo.
                                    </p>
                                </div>
                            )}

                            {!readOnly && (
                                <button
                                    onClick={() => setRequestingTrainer(true)}
                                    className="text-sm text-primary hover:underline"
                                >
                                    Kan du ikke finde din hometrainer? Anmod om godkendelse →
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {/* Request Trainer Modal */}
                {requestingTrainer && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                        <div className="bg-card p-6 rounded-lg max-w-md w-full shadow-xl border border-border">
                            <h3 className="text-lg font-bold mb-4 text-card-foreground">Anmod om hometrainer godkendelse</h3>
                            <p className="text-sm text-muted-foreground mb-4">
                                Indtast venligst det fulde navn på din hometrainer eller wattmåler. Vi vil derefter gennemgå den.
                            </p>
                            <input
                                type="text"
                                value={newTrainerName}
                                onChange={e => setNewTrainerName(e.target.value)}
                                className="w-full p-2 border border-input rounded mb-4 bg-background text-foreground"
                                placeholder="f.eks. Wahoo Kickr Core"
                            />
                            <div className="flex justify-end gap-2">
                                <button
                                    onClick={() => setRequestingTrainer(false)}
                                    className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
                                >
                                    Annuller
                                </button>
                                <button
                                    onClick={handleTrainerRequest}
                                    disabled={!newTrainerName.trim()}
                                    className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded hover:bg-primary-dark disabled:opacity-50"
                                >
                                    Send anmodning
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
