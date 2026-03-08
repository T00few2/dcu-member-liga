import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Ligainfo – Format, Kategorier & Point',
    description: 'Alt om DCU Ligaens løbsformat, rytterkategorier, pointsystem og ranglistepoint.',
    openGraph: {
        title: 'DCU Liga – Ligainfo',
        description: 'Alt om DCU Ligaens løbsformat, rytterkategorier, pointsystem og ranglistepoint.',
        url: '/info',
    },
};

export default function InfoLayout({ children }: { children: React.ReactNode }) {
    return children;
}
