import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Statistik",
  description: "Personlige præstationsstatistikker fra DCU forårsliga – sprintdata, placeringer og sæsonudvikling på Zwift.",
  openGraph: {
    title: "Statistik – DCU forårsliga",
    description: "Personlige præstationsstatistikker fra DCU forårsliga – sprintdata, placeringer og sæsonudvikling på Zwift.",
    url: "/stats",
  },
};

export default function StatsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
