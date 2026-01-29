'use client';

import { useRef } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useLiveRace } from '@/hooks/useLiveRace';
import { useLiveStandings } from '@/hooks/useLiveStandings';
import { useAutoScroll } from '@/hooks/useAutoScroll';
import { useFitToScreen } from '@/hooks/useFitToScreen';
import { useViewMode } from '@/hooks/useViewMode';
import { RaceResultsTable } from '@/components/live/RaceResultsTable';
import { TimeTrialTable } from '@/components/live/TimeTrialTable';
import { StandingsTable } from '@/components/live/StandingsTable';
import { resolveColor } from '@/lib/colors';
import { OverlayConfig } from '@/types/live';

export default function LiveResultsPage() {
    const params = useParams();
    const searchParams = useSearchParams();
    const raceId = params?.raceId as string;

    // --- Configuration from URL ---
    const categoryParam = searchParams.get('cat');
    const isTransparent = searchParams.get('transparent') !== 'false';
    const isFull = searchParams.get('full') === 'true';
    const titleParam = searchParams.get('title');
    const logoSrc = searchParams.get('logo') || '/live/logo.png';
    const bannerParam = searchParams.get('banner');
    const includeBanner = bannerParam !== 'false';
    const bannerSrc = includeBanner ? (bannerParam || '/live/banner.PNG') : '';
    const backgroundSrc = searchParams.get('bg') || '/live/background.jpg';
    
    // Parse limit
    const rawLimit = searchParams.get('limit');
    let limit = 10;
    if (rawLimit) {
        const parsed = parseInt(rawLimit);
        if (!isNaN(parsed) && parsed > 0) limit = parsed;
    }
    
    const autoScroll = searchParams.get('scroll') === 'true';
    const showSprints = searchParams.get('sprints') !== 'false';
    const showLastSprint = searchParams.get('lastSprint') === 'true';
    const showLastSplit = searchParams.get('lastSplit') === 'true';
    const fitToScreen = searchParams.get('fit') === 'true';
    const nameMaxParam = searchParams.get('nameMax');
    const nameMax = nameMaxParam ? parseInt(nameMaxParam) : NaN;
    const cycleTime = parseInt(searchParams.get('cycle') || '0');

    // Overlay Colors
    const overlay: OverlayConfig = {
        enabled: !isFull,
        text: !isFull ? searchParams.get('text') : null,
        muted: !isFull ? searchParams.get('muted') : null,
        accent: !isFull ? searchParams.get('accent') : null,
        positive: !isFull ? searchParams.get('positive') : null,
        headerText: !isFull ? searchParams.get('headerText') : null,
        headerBg: !isFull ? searchParams.get('headerBg') : null,
        rowText: !isFull ? searchParams.get('rowText') : null,
        rowBg: !isFull ? searchParams.get('rowBg') : null,
        rowAltBg: !isFull ? searchParams.get('rowAltBg') : null,
        border: !isFull ? searchParams.get('border') : null,
        background: !isFull ? searchParams.get('overlayBg') : null,
    };

    // --- Hooks ---
    const { race, loading, error } = useLiveRace(raceId);
    const { standings, bestRacesCount, allRaces, leagueName } = useLiveStandings();
    
    // View Mode
    const containerRef = useRef<HTMLDivElement>(null);
    const { viewMode } = useViewMode({
        initialView: searchParams.get('view'),
        cycleTime,
        onSwitch: () => {
            if (containerRef.current) containerRef.current.scrollTop = 0;
        }
    });

    // Auto Scroll
    useAutoScroll(containerRef, {
        enabled: autoScroll,
        dependencies: [race, viewMode, standings]
    });

    // Fit to Screen
    const tableWrapperRef = useRef<HTMLDivElement>(null);
    const fitScale = useFitToScreen(tableWrapperRef, containerRef, {
        enabled: fitToScreen,
        isFull,
        dependencies: [race, viewMode, standings, limit]
    });

    if (loading) return <div className="p-8 text-white font-bold text-2xl">Loading Live Data...</div>;
    if (error) return <div className="p-8 text-red-500 font-bold text-2xl">{error}</div>;
    if (!race) return null;

    // --- Data Processing ---
    let displayCategory = categoryParam;
    if (!displayCategory) {
        if (race.eventMode === 'multi' && race.eventConfiguration && race.eventConfiguration.length > 0) {
            const match = race.eventConfiguration.find((c: any) => c.eventId === raceId);
            if (match && match.customCategory) {
                displayCategory = match.customCategory;
            } else {
                if (race.eventConfiguration[0].customCategory) {
                    displayCategory = race.eventConfiguration[0].customCategory;
                }
            }
        }
        
        if (!displayCategory && race.results) {
             const categories = Object.keys(race.results);
             if (categories.length > 0) {
                 displayCategory = categories[0];
             }
        }
    }
    const category = displayCategory || 'A';
    
    let headerTitle = titleParam || leagueName || 'League';

    const renderContent = () => {
        if (viewMode === 'race') {
            // Calculate League Points Map
            const standingsForCategory = standings[category] || [];
            const raceKey = race.id || raceId;
            const leaguePointsByZwiftId = new Map<string, number>();
            
            standingsForCategory.forEach(entry => {
                const match = entry.results?.find(r => r.raceId === raceKey);
                if (match) {
                    leaguePointsByZwiftId.set(entry.zwiftId, match.points);
                }
            });

            return (
                <RaceResultsTable 
                    race={race} 
                    results={race.results?.[category] || []}
                    category={category}
                    config={{ showSprints, showLastSprint, isFull, nameMax }}
                    overlay={overlay}
                    standingsPoints={leaguePointsByZwiftId} 
                />
            );
        }
        if (viewMode === 'time-trial') {
            return (
                <TimeTrialTable
                    race={race}
                    results={race.results?.[category] || []}
                    category={category}
                    config={{ showLastSplit, isFull, nameMax }}
                    overlay={overlay}
                />
            );
        }
        return (
            <StandingsTable
                standings={standings[category] || []}
                allRaces={allRaces}
                category={category}
                bestRacesCount={bestRacesCount}
                config={{ isFull, limit, nameMax }}
                overlay={overlay}
            />
        );
    };

    // --- Layout ---
    
    if (isFull) {
        return (
            <div className="fixed inset-0 z-50 overflow-hidden font-sans text-white">
                <div
                    className="absolute inset-0 bg-slate-600"
                    style={{
                        backgroundImage: backgroundSrc ? `url(${backgroundSrc})` : undefined,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        filter: 'blur(6px)',
                        transform: 'scale(1.03)'
                    }}
                />
                <div className="absolute inset-0 bg-slate-600/30" />

                <div className="relative z-10 flex h-full flex-col">
                    <header className="relative flex items-center justify-center py-6">
                        <div className="text-center">
                            <h1 className="text-4xl md:text-6xl font-black tracking-wide">{headerTitle}</h1>
                            <p className="mt-2 text-xl md:text-2xl text-slate-200 uppercase tracking-widest">
                                {viewMode === 'standings'
                                    ? `Standings • ${category}`
                                    : `${race.name} • ${category}`}
                            </p>
                        </div>

                        {logoSrc && (
                            <img
                                src={logoSrc}
                                alt="Logo"
                                className="absolute right-6 top-6 z-20 h-16 md:h-24 object-contain"
                                style={{ filter: 'none' }}
                            />
                        )}
                    </header>

                    <div
                        ref={containerRef}
                        className={`flex-1 px-6 ${fitToScreen ? 'overflow-hidden flex flex-col' : 'overflow-auto'} ${autoScroll ? 'scrollbar-hide' : ''}`}
                    >
                        {fitToScreen ? (
                            <div className="flex-1 relative">
                                <div 
                                    ref={tableWrapperRef}
                                    className="absolute top-0 left-0 right-0 mx-auto max-w-6xl rounded-xl border border-slate-700/70 bg-slate-600/25 shadow-2xl backdrop-blur"
                                    style={{
                                        transform: `scale(${fitScale})`,
                                        transformOrigin: 'top center',
                                        width: '100%'
                                    }}
                                >
                                    {renderContent()}
                                </div>
                            </div>
                        ) : (
                            <div 
                                ref={tableWrapperRef}
                                className="mx-auto max-w-6xl rounded-xl border border-slate-700/70 bg-slate-600/25 shadow-2xl backdrop-blur"
                            >
                                {renderContent()}
                            </div>
                        )}
                    </div>

                    {includeBanner && bannerSrc && (
                        <div className="flex justify-center py-6">
                            <img
                                src={bannerSrc}
                                alt="Banner"
                                className="h-16 md:h-20 object-contain opacity-70"
                            />
                        </div>
                    )}
                </div>

                <style jsx global>{`
                    .site-footer { display: none !important; }
                    .scrollbar-hide::-webkit-scrollbar { display: none; }
                    .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
                `}</style>
            </div>
        );
    }

    // Windowed / Overlay Mode
    return (
        <div 
            className={`fixed inset-0 z-50 overflow-hidden font-sans ${
                isTransparent ? 'bg-transparent' : 'bg-slate-900'
            }`}
            style={{
                backgroundColor: !isTransparent ? resolveColor(overlay.background) : undefined,
                color: resolveColor(overlay.text)
            }}
        >
            <div 
                ref={containerRef}
                className={`h-full w-full overflow-auto ${autoScroll ? 'scrollbar-hide' : ''}`}
            >
                <div className="p-0">
                    <div
                        className="sticky top-0 z-20 bg-slate-900/90 text-center py-2 border-b border-slate-700"
                        style={{
                            backgroundColor: resolveColor(overlay.headerBg, overlay.background),
                            borderColor: resolveColor(overlay.border),
                            color: resolveColor(overlay.headerText, overlay.text)
                        }}
                    >
                        <h2
                            className="text-xl font-bold text-white uppercase tracking-widest"
                            style={{ color: resolveColor(overlay.headerText, overlay.text) }}
                        >
                            {viewMode === 'standings'
                                ? `League Standings • ${category}`
                                : viewMode === 'time-trial'
                                    ? `Time Trail • ${category}`
                                    : `Race Results • ${category}`}
                        </h2>
                    </div>

                    {renderContent()}
                </div>
            </div>
            
            <style jsx global>{`
                .site-footer { display: none !important; }
                .scrollbar-hide::-webkit-scrollbar { display: none; }
                .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
            `}</style>
        </div>
    );
}
