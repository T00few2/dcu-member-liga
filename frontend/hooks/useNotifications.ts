'use client';

import { useAuth } from '@/lib/auth-context';
import { useNotificationStateQuery } from './queries/useNotificationStateQuery';
import { useUnreadNews } from './useUnreadNews';

export function useNotifications() {
    const { weightVerificationStatus } = useAuth();
    const { data: ns } = useNotificationStateQuery();
    const { hasUnreadNews } = useUnreadNews();

    const weightNeedsAction =
        weightVerificationStatus === 'pending' || weightVerificationStatus === 'rejected';

    const dualRecordingFlagged =
        !!ns?.latestDrFailedAt &&
        (!ns.drReportSeenAt || ns.latestDrFailedAt > ns.drReportSeenAt);

    const stickyWattsFlagged =
        !!ns?.latestSwFlaggedAt &&
        (!ns.swReportSeenAt || ns.latestSwFlaggedAt > ns.swReportSeenAt);

    return { weightNeedsAction, dualRecordingFlagged, stickyWattsFlagged, hasUnreadNews };
}
