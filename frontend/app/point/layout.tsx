import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Point',
    description: 'Pointskalaer for løbsdag og sæsonprestige i DCU E-serien.',
    openGraph: {
        title: 'Point – DCU E-serien',
        description: 'Pointskalaer for løbsdag og sæsonprestige i DCU E-serien.',
        url: '/point',
    },
};

export default function PointLayout({ children }: { children: React.ReactNode }) {
    return children;
}
