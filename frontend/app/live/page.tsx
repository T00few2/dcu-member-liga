'use client';

import { useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';

// Hooks
import { useOverlayConfig } from '@/hooks/useOverlayConfig';
import { useLiveRaces } from '@/hooks/useLiveRaces';

// Components
import {
    ConfigPanel,
    OverlayColorPanel,
    LiveLinksMatrix,
    LiveResultsModal,
    CategoryResultsModal,
} from '@/components/live-dashboard';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export default function LiveLinksPage() {
    const { user, isAdmin } = useAuth();

    // Custom hooks for data and config
    const {
        config,
        savedSchemes,
        schemeName,
        setSchemeName,
        updateConfig,
        applyPalette,
        saveScheme,
        deleteScheme,
    } = useOverlayConfig();

    const {
        races,
        allCategories,
        loading,
        getRaceCategories,
        refreshRace,
        handleToggleDQ,
        handleToggleDeclass,
        handleToggleExclude,
    } = useLiveRaces(user);

    // Local UI state
    const [processingKey, setProcessingKey] = useState<string | null>(null);
    const [processingCategory, setProcessingCategory] = useState<string | null>(null);
    const [viewingResultsId, setViewingResultsId] = useState<string | null>(null);
    const [viewingCategory, setViewingCategory] = useState<string | null>(null);

    // Refresh results for a single race/category
    const handleRefresh = useCallback(async (raceId: string, category: string = 'All') => {
        if (!user) {
            alert('Please log in to calculate results.');
            return;
        }

        const key = `${raceId}-${category}`;
        setProcessingKey(key);

        try {
            const token = await user.getIdToken();

            const res = await fetch(`${API_URL}/races/${raceId}/results/refresh`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    source: config.source,
                    filterRegistered: config.filterRegistered,
                    categoryFilter: category,
                }),
            });

            if (!res.ok) {
                const data = await res.json();
                alert(`Failed: ${data.message}`);
            } else {
                // Refresh local state from Firebase after successful calculation
                await refreshRace(raceId);
            }
        } catch (e) {
            console.error(e);
            alert('Error updating results');
        } finally {
            setProcessingKey(null);
        }
    }, [user, config.source, config.filterRegistered, refreshRace]);

    // Refresh all races for a specific category
    const handleRefreshCategory = useCallback(async (category: string) => {
        if (!user) {
            alert('Please log in to calculate results.');
            return;
        }

        setProcessingCategory(category);

        try {
            const racesToUpdate = races.filter(race => {
                const raceCats = getRaceCategories(race);
                return raceCats.has(category);
            });

            for (const race of racesToUpdate) {
                await handleRefresh(race.id, category);
            }
        } catch (e) {
            console.error(e);
            alert('Error updating category results');
        } finally {
            setProcessingCategory(null);
        }
    }, [user, races, getRaceCategories, handleRefresh]);

    // Loading state
    if (loading) {
        return <div className="p-8 text-white">Loading races...</div>;
    }

    // Get currently viewing race
    const viewingRace = viewingResultsId
        ? races.find(r => r.id === viewingResultsId) || null
        : null;

    return (
        <div className="min-h-screen bg-slate-900 text-slate-100 p-8 font-sans">
            <h1 className="text-3xl font-bold mb-8 text-blue-400">Live Dashboard Generator</h1>

            {/* Configuration Panel */}
            <ConfigPanel
                config={config}
                user={user}
                updateConfig={updateConfig}
            />

            {/* Overlay Color Settings */}
            <OverlayColorPanel
                config={config}
                savedSchemes={savedSchemes}
                schemeName={schemeName}
                onSchemeNameChange={setSchemeName}
                onApplyPalette={applyPalette}
                onSaveScheme={saveScheme}
                onDeleteScheme={deleteScheme}
                updateConfig={updateConfig}
            />

            {/* Race/Category Matrix */}
            <LiveLinksMatrix
                races={races}
                allCategories={allCategories}
                config={config}
                user={user}
                processingKey={processingKey}
                processingCategory={processingCategory}
                getRaceCategories={getRaceCategories}
                onRefresh={handleRefresh}
                onRefreshCategory={handleRefreshCategory}
                onViewResults={setViewingResultsId}
                onViewCategory={setViewingCategory}
                isAdmin={isAdmin}
            />

            {/* Results Modal (Single Race) */}
            <LiveResultsModal
                race={viewingRace}
                processingKey={processingKey}
                onClose={() => setViewingResultsId(null)}
                onRefresh={handleRefresh}
                onToggleDQ={handleToggleDQ}
                onToggleDeclass={handleToggleDeclass}
                onToggleExclude={handleToggleExclude}
            />

            {/* Category Results Modal (All Races in Category) */}
            <CategoryResultsModal
                category={viewingCategory}
                races={races}
                processingKey={processingKey}
                processingCategory={processingCategory}
                onClose={() => setViewingCategory(null)}
                onRefresh={handleRefresh}
                onRefreshCategory={handleRefreshCategory}
                onToggleDQ={handleToggleDQ}
                onToggleDeclass={handleToggleDeclass}
                onToggleExclude={handleToggleExclude}
            />
        </div>
    );
}
