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
        !!ns?.trainerRequiresDualRecording &&
        !!ns?.latestDrFailedAt &&
        (!ns.drReportSeenAt || ns.latestDrFailedAt > ns.drReportSeenAt);

    const stickyWattsFlagged =
        !!ns?.latestSwFlaggedAt &&
        (!ns.swReportSeenAt || ns.latestSwFlaggedAt > ns.swReportSeenAt);

    const ghostWattsFlagged =
        !!ns?.latestGwFlaggedAt &&
        (!ns.gwReportSeenAt || ns.latestGwFlaggedAt > ns.gwReportSeenAt);

    return { weightNeedsAction, dualRecordingFlagged, stickyWattsFlagged, ghostWattsFlagged, hasUnreadNews };
}
