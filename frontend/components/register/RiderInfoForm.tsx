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
    readOnly?: boolean;
}

export default function RiderInfoForm({
    name, setName,
    club, setClub,
    trainer, setTrainer,
    clubs, loadingClubs, clubsError,
    trainers, loadingTrainers, trainersError,
    onRequestTrainer,
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

    const handleClubKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, filteredClubs: Club[], selectClub: (c: Club) => void) => {
        if (!showClubList) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setFocusedClubIndex(i => Math.min(i + 1, filteredClubs.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setFocusedClubIndex(i => Math.max(i - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (focusedClubIndex >= 0 && focusedClubIndex < filteredClubs.length) {
                selectClub(filteredClubs[focusedClubIndex]);
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
                                const selectClub = (c: Club) => {
                                    setClub(c.name); setClubSearch(c.name);
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
                                                    // Only propagate to parent when field is cleared;
                                                    // a valid club is only set by selecting from the list.
                                                    if (!e.target.value) setClub('');
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
                                                {filteredClubs.length === 0 ? (
                                                    <div className="p-3 text-sm text-muted-foreground">Ingen klubber fundet</div>
                                                ) : (
                                                    filteredClubs.map((c, idx) => (
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
                                                    ))
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
                            {clubSearch && !club && !showClubList && !readOnly && (
                                <p className="mt-1 text-xs text-red-500">Vælg en klub fra listen</p>
                            )}
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
                                        ⚠️ <strong>Dual Recording påkrævet</strong>: Strava skal forbindes og bruges til automatisk upload af dual recording.
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
