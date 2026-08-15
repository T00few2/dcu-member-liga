'use client';

import { formatElapsedTime } from '@/lib/timeFormat';
import type { FinishAudit, FinishAuditIssue } from '@/types/admin';

function issueLabel(issue: FinishAuditIssue): string {
    switch (issue.type) {
        case 'duration_mismatch':
            return 'Duration mismatch';
        case 'missing_in_official':
            return 'In derived results, missing from official';
        case 'missing_in_derived':
            return 'Official finisher missing from derived results';
        case 'missing_activity_id':
            return 'Derived finisher has no activityId';
        case 'fetch_error':
            return 'Official fetch error';
        default:
            return issue.type || 'Issue';
    }
}

function issueDetail(issue: FinishAuditIssue): string {
    if (issue.type === 'fetch_error') {
        return issue.detail || 'Could not fetch official race-results';
    }
    const who = [issue.name, issue.zwiftId && `#${issue.zwiftId}`, issue.category]
        .filter(Boolean)
        .join(' · ');
    if (issue.type === 'duration_mismatch') {
        const derived = formatElapsedTime(issue.derivedFinishTime ?? null);
        const official = formatElapsedTime(issue.officialDuration ?? null);
        const delta = issue.deltaMs != null ? `${issue.deltaMs} ms` : 'n/a';
        return `${who}: derived ${derived} vs official ${official} (delta ${delta})`;
    }
    return who || issue.detail || '';
}

export default function FinishAuditPanel({ audit }: { audit?: FinishAudit }) {
    if (!audit?.status && !audit?.summary) {
        return null;
    }

    const status = audit.status || 'unavailable';
    const tone =
        status === 'aligned'
            ? 'border-green-600/50 bg-green-600/10 text-green-800 dark:text-green-300'
            : status === 'mismatch'
              ? 'border-amber-600/50 bg-amber-600/10 text-amber-900 dark:text-amber-300'
              : 'border-border bg-muted/30 text-muted-foreground';

    const heading =
        status === 'aligned'
            ? 'Finish audit: aligned'
            : status === 'mismatch'
              ? 'Finish audit: mismatch'
              : 'Finish audit: unavailable';

    const issues = Array.isArray(audit.issues) ? audit.issues : [];

    return (
        <div className={`text-xs px-2 py-2 rounded border space-y-1.5 ${tone}`}>
            <p className="font-semibold">{heading}</p>
            <p>{audit.summary}</p>
            <p className="text-[11px] opacity-80">
                Compared {audit.alignedCount ?? 0}/{audit.comparedCount ?? 0} derived
                finishers to {audit.officialEntryCount ?? 0} official
                {audit.subgroupCount != null ? ` across ${audit.subgroupCount} subgroup(s)` : ''}.
            </p>
            {issues.length > 0 && (
                <ul className="list-disc pl-4 space-y-1">
                    {issues.map((issue, index) => (
                        <li key={`${issue.type || 'issue'}-${issue.zwiftId || index}`}>
                            <span className="font-medium">{issueLabel(issue)}</span>
                            {issueDetail(issue) ? ` — ${issueDetail(issue)}` : ''}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
