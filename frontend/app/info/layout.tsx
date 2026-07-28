import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Info – Format, kategorier & point',
    description: 'Alt om DCU E-seriens sæsonformat, rytterkategorier og pointsystem.',
    openGraph: {
        title: 'Info – DCU E-serien',
        description: 'Alt om DCU E-seriens sæsonformat, rytterkategorier og pointsystem.',
        url: '/info',
    },
};

export default function InfoLayout({ children }: { children: React.ReactNode }) {
    return children;
}
