'use client';

import { useEffect } from 'react';
import { useNotifications } from '@/hooks/useNotifications';

export default function AppBadgeSync() {
    const { weightNeedsAction, dualRecordingFlagged, stickyWattsFlagged, hasUnreadNews } = useNotifications();
    const count = [weightNeedsAction, dualRecordingFlagged, stickyWattsFlagged, hasUnreadNews].filter(Boolean).length;

    useEffect(() => {
        if (!('setAppBadge' in navigator)) return;
        if (count > 0) {
            // @ts-ignore
            navigator.setAppBadge(count).catch(() => {});
        } else {
            // @ts-ignore
            navigator.clearAppBadge().catch(() => {});
        }
    }, [count]);

    return null;
}
