'use client';

import { useEffect } from 'react';
import { useUnreadNews } from '@/hooks/useUnreadNews';

/** Marks the newest post as read when a news page opens, as the pages did before. */
export default function MarkNewsRead({ postId }: { postId: string | null }) {
    const { markNewsAsRead } = useUnreadNews();

    useEffect(() => {
        if (postId) markNewsAsRead(postId);
    // markNewsAsRead is stable (useCallback); intentionally omitting from deps to fire once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [postId]);

    return null;
}
