'use client';

import { useRoutesQuery } from '@/hooks/queries';
import { RoutePlanningTab } from '@/components/admin/league-manager';

export default function RoutePlannerPage() {
    const routesQuery = useRoutesQuery();
    const routes = routesQuery.data ?? [];

    return (
        <div className="max-w-6xl mx-auto px-4 py-8 pb-24">
            <h1 className="text-3xl font-bold mb-2 text-foreground">Route Planner</h1>
            <p className="text-muted-foreground mb-8">
                Pick a map and route, set a target W/kg per category, and estimate lap counts and finish times.
            </p>

            {routesQuery.isLoading ? (
                <div className="p-8 text-center text-muted-foreground">Loading routes...</div>
            ) : (
                <RoutePlanningTab routes={routes} />
            )}
        </div>
    );
}
