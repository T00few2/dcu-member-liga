'use client';

import { useAuth } from '@/lib/auth-context';
import { useProfileQuery } from '@/hooks/queries';
import { defaultPosterAuthor } from '@/lib/postAuthorOptions';

export function usePosterAuthorDefault() {
    const { user } = useAuth();
    const profileQuery = useProfileQuery();
    return defaultPosterAuthor({
        profileName: profileQuery.data?.name,
        profileZwiftId: profileQuery.data?.zwiftId,
        authDisplayName: user?.displayName,
        authEmail: user?.email,
    });
}
