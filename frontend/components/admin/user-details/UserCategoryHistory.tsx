'use client';

import { UserDetail } from './types';
import { fmtDate, SectionCard, Row, Badge, CATEGORY_STYLES } from './shared';

export interface UserCategoryHistoryProps {
    ligaCategory: UserDetail['ligaCategory'];
}

export default function UserCategoryHistory({ ligaCategory }: UserCategoryHistoryProps) {
    return (
        <SectionCard title="Liga Category">
            <Row label="Effective category" value={
                ligaCategory.category ? (
                    <Badge label={ligaCategory.category} className={CATEGORY_STYLES[ligaCategory.category] ?? 'bg-gray-100 text-gray-700'} />
                ) : '—'
            } />
            <Row label="Locked" value={ligaCategory.locked ? `Yes (${fmtDate(ligaCategory.lockedAt)})` : 'No'} />
            {ligaCategory.autoAssigned && (
                <>
                    <div className="pt-2 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Auto-assigned</div>
                    <Row label="Category" value={ligaCategory.autoAssigned.category || '—'} />
                    <Row label="Season" value={ligaCategory.autoAssigned.season || '—'} />
                    <Row label="Status" value={ligaCategory.autoAssigned.status || '—'} />
                    <Row label="Assigned rating" value={ligaCategory.autoAssigned.assignedRating != null ? Number(ligaCategory.autoAssigned.assignedRating).toFixed(0) : '—'} />
                    <Row label="Last checked" value={fmtDate(ligaCategory.autoAssigned.lastCheckedAt)} />
                </>
            )}
            {ligaCategory.selfSelected?.category && (
                <>
                    <div className="pt-2 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Self-selected</div>
                    <Row label="Category" value={ligaCategory.selfSelected.category} />
                    <Row label="Selected" value={fmtDate(ligaCategory.selfSelected.selfSelectedAt)} />
                </>
            )}
        </SectionCard>
    );
}
