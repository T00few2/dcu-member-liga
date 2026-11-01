import MarkdownRenderer from '@/components/MarkdownRenderer';
import type { PublicPolicy } from '@/lib/publicSnapshot';

export default function PolicyArticle({
    policy,
    footer,
}: {
    policy: PublicPolicy | null;
    footer?: React.ReactNode;
}) {
    if (!policy) {
        return (
            <div className="max-w-4xl mx-auto mt-10 p-8 bg-card rounded-lg shadow-md border border-border">
                <p className="text-muted-foreground">Teksten kunne ikke hentes.</p>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto mt-10 p-8 bg-card rounded-lg shadow-md border border-border">
            <h1 className="text-3xl font-bold mb-2 text-card-foreground">{policy.titleDa}</h1>
            {policy.version ? (
                <p className="text-sm text-muted-foreground mb-8">Version {policy.version}</p>
            ) : null}
            <div className="prose prose-slate dark:prose-invert max-w-none">
                <MarkdownRenderer markdown={policy.contentMdDa} />
                {footer}
            </div>
        </div>
    );
}
