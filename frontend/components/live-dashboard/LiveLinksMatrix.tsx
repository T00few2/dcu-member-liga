'use client';

import Link from 'next/link';
import { User } from 'firebase/auth';
import type { LiveRace } from '@/hooks/useLiveRaces';
import type { LiveConfig } from '@/types/overlay';

interface LiveLinksMatrixProps {
    races: LiveRace[];
    allCategories: string[];
    config: LiveConfig;
    user: User | null;
    processingKey: string | null;
    processingCategory: string | null;
    getRaceCategories: (race: LiveRace) => Set<string>;
    onRefresh: (raceId: string, category: string) => Promise<void>;
    onRefreshCategory: (category: string) => Promise<void>;
    onViewResults: (raceId: string) => void;
    onViewCategory: (category: string) => void;
}

// Generate URL for live page
function generateUrl(
    raceId: string,
    category: string,
    config: LiveConfig,
    races: LiveRace[],
    forceView?: string,
    forceFull?: boolean
): string {
    const baseUrl = `/live/${raceId}`;
    const params = new URLSearchParams();
    
    params.set('cat', category);
    if (config.limit !== 10) params.set('limit', config.limit.toString());
    
    // View Logic
    if (forceView) {
        params.set('view', forceView);
    } else {
        const race = races.find(r => r.id === raceId);
        if (race?.type === 'time-trial') {
            params.set('view', 'time-trial');
        }
    }

    if (config.cycle > 0) params.set('cycle', config.cycle.toString());
    if (!config.transparent) params.set('transparent', 'false');
    if (config.scroll) params.set('scroll', 'true');
    if (!config.sprints) params.set('sprints', 'false');
    if (config.lastSprint) params.set('lastSprint', 'true');
    
    // Full Screen Logic
    if (forceFull) {
        params.set('full', 'true');
    } else if (config.full && forceFull !== false) {
        params.set('full', 'true');
    }

    if (!config.includeBanner) params.set('banner', 'false');
    if (config.fitToScreen) params.set('fit', 'true');
    if (config.lastSplit) params.set('lastSplit', 'true');
    if (config.nameMax.trim()) params.set('nameMax', config.nameMax.trim());
    if (config.overlayText.trim()) params.set('text', config.overlayText.trim());
    if (config.overlayMuted.trim()) params.set('muted', config.overlayMuted.trim());
    if (config.overlayAccent.trim()) params.set('accent', config.overlayAccent.trim());
    if (config.overlayPositive.trim()) params.set('positive', config.overlayPositive.trim());
    if (config.overlayHeaderText.trim()) params.set('headerText', config.overlayHeaderText.trim());
    if (config.overlayHeaderBg.trim()) params.set('headerBg', config.overlayHeaderBg.trim());
    if (config.overlayRowText.trim()) params.set('rowText', config.overlayRowText.trim());
    if (config.overlayRowBg.trim()) params.set('rowBg', config.overlayRowBg.trim());
    if (config.overlayRowAltBg.trim()) params.set('rowAltBg', config.overlayRowAltBg.trim());
    if (config.overlayBorder.trim()) params.set('border', config.overlayBorder.trim());
    if (config.overlayBackground.trim()) params.set('overlayBg', config.overlayBackground.trim());

    return `${baseUrl}?${params.toString()}`;
}

function copyToClipboard(text: string) {
    navigator.clipboard.writeText(window.location.origin + text);
}

export default function LiveLinksMatrix({
    races,
    allCategories,
    config,
    user,
    processingKey,
    processingCategory,
    getRaceCategories,
    onRefresh,
    onRefreshCategory,
    onViewResults,
    onViewCategory,
}: LiveLinksMatrixProps) {
    return (
        <>
            <div className="overflow-x-auto rounded-lg border border-slate-700 shadow-xl">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-slate-800 text-slate-400 uppercase tracking-wider text-sm">
                            <th className="p-4 border-b border-slate-700 sticky left-0 bg-slate-800 z-10 w-64 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.5)]">
                                Race
                            </th>
                            {allCategories.map(cat => (
                                <th key={cat} className="p-4 border-b border-slate-700 text-center min-w-[100px]">
                                    <div className="flex flex-col gap-2 items-center">
                                        <span>{cat}</span>
                                        {user && (
                                            <div className="flex gap-1">
                                                <button 
                                                    onClick={() => onRefreshCategory(cat)}
                                                    disabled={!!processingCategory}
                                                    className={`px-2 py-1 text-[10px] uppercase font-bold rounded border transition-colors ${
                                                        processingCategory === cat 
                                                            ? 'bg-slate-700 text-slate-400 border-slate-600 cursor-not-allowed' 
                                                            : 'bg-slate-800 text-green-500 border-green-900/50 hover:bg-green-900/20 hover:border-green-800'
                                                    }`}
                                                >
                                                    {processingCategory === cat ? '...' : 'Calc All'}
                                                </button>
                                                <button
                                                    onClick={() => onViewCategory(cat)}
                                                    className="px-2 py-1 text-[10px] uppercase font-bold rounded border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500"
                                                >
                                                    View
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="bg-slate-900/50">
                        {races.map((race) => {
                            const raceCats = getRaceCategories(race);

                            return (
                                <tr 
                                    key={race.id} 
                                    className="hover:bg-slate-800/50 transition-colors border-b border-slate-800 last:border-0"
                                >
                                    <td className="p-4 border-r border-slate-800 sticky left-0 bg-slate-900 z-10 font-medium text-slate-200 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.5)]">
                                        <div className="truncate w-64" title={race.name}>
                                            {race.name}
                                        </div>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className="text-xs text-slate-500">
                                                {new Date(race.date).toLocaleDateString()}
                                            </span>
                                            {user && (
                                                <button
                                                    onClick={() => onViewResults(race.id)}
                                                    className="px-2 py-0.5 text-[10px] uppercase font-bold rounded border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 transition-colors"
                                                >
                                                    View
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                    {allCategories.map(cat => {
                                        const isAvailable = raceCats.has(cat);
                                        const urlOverlay = generateUrl(race.id, cat, config, races, undefined, false);
                                        const urlFull = generateUrl(race.id, cat, config, races, undefined, true);
                                        
                                        return (
                                            <td 
                                                key={cat} 
                                                className="p-3 text-center border-r border-slate-800/50 last:border-0 min-w-[140px]"
                                            >
                                                {isAvailable ? (
                                                    <div className="flex flex-col gap-2 items-center w-full">
                                                        <div className="grid grid-cols-[1fr_auto] gap-2 w-full">
                                                            <Link 
                                                                href={urlOverlay} 
                                                                target="_blank"
                                                                className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-white text-[10px] font-bold rounded transition-colors text-center truncate"
                                                            >
                                                                Overlay
                                                            </Link>
                                                            <button
                                                                onClick={() => copyToClipboard(urlOverlay)}
                                                                className="px-2 py-1 bg-slate-800 border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-white text-[10px] font-bold rounded transition-colors"
                                                                title="Copy Overlay Link"
                                                            >
                                                                Copy
                                                            </button>
                                                            
                                                            <Link 
                                                                href={urlFull} 
                                                                target="_blank"
                                                                className="px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold rounded transition-colors text-center truncate"
                                                            >
                                                                Full Screen
                                                            </Link>
                                                            <button
                                                                onClick={() => copyToClipboard(urlFull)}
                                                                className="px-2 py-1 bg-slate-800 border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-white text-[10px] font-bold rounded transition-colors"
                                                                title="Copy Full Screen Link"
                                                            >
                                                                Copy
                                                            </button>
                                                        </div>
                                                        {user && (
                                                            <button 
                                                                onClick={() => onRefresh(race.id, cat)}
                                                                disabled={!!processingKey}
                                                                className={`w-full px-2 py-1 mt-1 text-[10px] uppercase font-bold rounded border transition-colors flex items-center justify-center ${
                                                                    processingKey === `${race.id}-${cat}` 
                                                                        ? 'bg-slate-700 text-slate-400 border-slate-600 cursor-wait' 
                                                                        : 'bg-green-900/30 border-green-800 text-green-400 hover:bg-green-900/50 hover:text-green-300'
                                                                }`}
                                                            >
                                                                {processingKey === `${race.id}-${cat}` ? '...' : 'Calc'}
                                                            </button>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-slate-700 text-xl">·</span>
                                                )}
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}

                        {/* League Standings Row */}
                        <tr className="border-t-2 border-slate-700 bg-slate-800/80">
                            <td className="p-4 border-r border-slate-800 sticky left-0 bg-slate-800 z-10 font-bold text-slate-100 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.5)]">
                                League Standings
                            </td>
                            {allCategories.map(cat => {
                                const latestRaceId = races.length > 0 ? races[races.length - 1].id : 'no-race';
                                const urlOverlay = generateUrl(latestRaceId, cat, config, races, 'standings', false);
                                const urlFull = generateUrl(latestRaceId, cat, config, races, 'standings', true);
                                
                                return (
                                    <td 
                                        key={cat} 
                                        className="p-3 text-center border-r border-slate-800/50 last:border-0 min-w-[140px]"
                                    >
                                        {latestRaceId !== 'no-race' ? (
                                            <div className="flex flex-col gap-2 items-center w-full">
                                                <div className="grid grid-cols-[1fr_auto] gap-2 w-full">
                                                    <Link 
                                                        href={urlOverlay} 
                                                        target="_blank"
                                                        className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-white text-[10px] font-bold rounded transition-colors text-center truncate"
                                                    >
                                                        Overlay
                                                    </Link>
                                                    <button
                                                        onClick={() => copyToClipboard(urlOverlay)}
                                                        className="px-2 py-1 bg-slate-800 border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-white text-[10px] font-bold rounded transition-colors"
                                                        title="Copy Overlay Link"
                                                    >
                                                        Copy
                                                    </button>
                                                    
                                                    <Link 
                                                        href={urlFull} 
                                                        target="_blank"
                                                        className="px-2 py-1 bg-purple-600 hover:bg-purple-500 text-white text-[10px] font-bold rounded transition-colors text-center truncate"
                                                    >
                                                        Full Screen
                                                    </Link>
                                                    <button
                                                        onClick={() => copyToClipboard(urlFull)}
                                                        className="px-2 py-1 bg-slate-800 border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-white text-[10px] font-bold rounded transition-colors"
                                                        title="Copy Full Screen Link"
                                                    >
                                                        Copy
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <span className="text-slate-600 text-sm italic">No data</span>
                                        )}
                                    </td>
                                );
                            })}
                        </tr>
                    </tbody>
                </table>
            </div>
            
            <div className="mt-8 text-slate-500 text-sm text-center">
                Click "Open" buttons to view in a new tab, or "Copy" buttons to paste into OBS/Streaming software.
            </div>
        </>
    );
}
