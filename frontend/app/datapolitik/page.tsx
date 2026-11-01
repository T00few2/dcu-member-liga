import Link from 'next/link';
import PolicyArticle from '@/components/public/PolicyArticle';
import { loadCurrentPolicy } from '@/lib/publicSnapshot';

export const dynamic = 'force-dynamic';

export default async function DataPolicyPage() {
    const policy = await loadCurrentPolicy('dataPolicy');
    return (
        <PolicyArticle
            policy={policy}
            footer={
                <p className="text-sm text-muted-foreground">
                    Tilbage til <Link href="/register" className="text-primary hover:underline">registrering</Link>.
                </p>
            }
        />
    );
}
