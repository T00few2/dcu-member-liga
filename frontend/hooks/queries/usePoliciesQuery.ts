'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';

export interface PolicyVersion {
    version: string;
    titleDa?: string;
    changeType?: 'minor' | 'major';
    requiresReaccept?: boolean;
    status?: 'draft' | 'pending_review' | 'approved' | 'published' | 'rejected';
    createdByUid?: string;
    approvedByUid?: string;
    publishedByUid?: string;
    createdAt?: number;
    updatedAt?: number;
    submittedAt?: number;
    approvedAt?: number;
    publishedAt?: number;
    changeSummary?: string;
    contentMdDa?: string;
}

export interface PolicyMeta {
    displayVersion: string;
    requiredVersion: string;
}

export interface PolicyMetaResult {
    knownPolicies: string[];
    policies: Record<string, PolicyMeta>;
}

export interface PolicyVersionsResult {
    versions: PolicyVersion[];
}

export function usePoliciesMetaQuery() {
    return useQuery({
        queryKey: ['policy', 'meta'],
        queryFn: async () => {
            const res = await fetch(`${API_URL}/policy/meta`);
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || 'Failed to load policy meta');
            return {
                knownPolicies: (data.knownPolicies ?? []) as string[],
                policies: (data.policies ?? {}) as Record<string, PolicyMeta>,
            } satisfies PolicyMetaResult;
        },
        staleTime: 5 * 60_000,
    });
}

export function usePoliciesVersionsQuery(policyKey: string) {
    const { user } = useAuth();

    return useQuery({
        queryKey: ['policy', 'versions', policyKey],
        queryFn: async () => {
            const token = await user!.getIdToken();
            const res = await fetch(`${API_URL}/admin/policy/${policyKey}/versions`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || 'Failed to load versions');
            return (data.versions ?? []) as PolicyVersion[];
        },
        enabled: !!user && !!policyKey,
        staleTime: 5 * 60_000,
    });
}
