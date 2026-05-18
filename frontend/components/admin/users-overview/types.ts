export interface UserRow {
    userId: string;
    zwiftId: string;
    name: string;
    email: string;
    club: string;
    trainer: string;
    category: string;
    categoryLocked: boolean;
    zwiftConnected: boolean;
    stravaConnected: boolean;
    needsStravaForDR: boolean;
    verificationStatus: string;
    currentRating: number | string;
    max30Rating: number | string;
    phenotype: string;
    signedUpAt: number | null;
}

export type SortKey = keyof UserRow;
export type SortDir = 'asc' | 'desc';

export const CATEGORY_STYLES: Record<string, string> = {
    Diamond:  'bg-cyan-100 text-cyan-800',
    Ruby:     'bg-red-100 text-red-800',
    Emerald:  'bg-green-100 text-green-800',
    Sapphire: 'bg-blue-100 text-blue-800',
    Amethyst: 'bg-purple-100 text-purple-800',
    Platinum: 'bg-slate-100 text-slate-700',
    Gold:     'bg-yellow-100 text-yellow-800',
    Silver:   'bg-gray-100 text-gray-700',
    Bronze:   'bg-orange-100 text-orange-800',
    Copper:   'bg-amber-100 text-amber-800',
};

export const VERIFICATION_STYLES: Record<string, string> = {
    approved:  'bg-green-100 text-green-800',
    submitted: 'bg-blue-100 text-blue-800',
    pending:   'bg-yellow-100 text-yellow-800',
    rejected:  'bg-red-100 text-red-800',
    none:      'bg-gray-100 text-gray-600',
};
