import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Info – Format, hold, kategorier & point',
    description: 'Alt om DCU E-seriens sæsonformat, deltagende hold, rytterkategorier og pointsystem.',
    openGraph: {
        title: 'Info – DCU E-serien',
        description: 'Alt om DCU E-seriens sæsonformat, deltagende hold, rytterkategorier og pointsystem.',
        url: '/info',
    },
};

export default function InfoLayout({ children }: { children: React.ReactNode }) {
    return children;
}
