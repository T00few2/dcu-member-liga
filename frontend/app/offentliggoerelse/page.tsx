import PolicyArticle from '@/components/public/PolicyArticle';
import { loadCurrentPolicy } from '@/lib/publicSnapshot';

export const dynamic = 'force-dynamic';

export default async function PublicResultsPolicyPage() {
    const policy = await loadCurrentPolicy('publicResultsConsent');
    return <PolicyArticle policy={policy} />;
}
