import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Statistik",
  description: "Personlige præstationsstatistikker fra DCU E-serien – sprintdata, placeringer og sæsonudvikling på Zwift.",
  openGraph: {
    title: "Statistik – DCU E-serien",
    description: "Personlige præstationsstatistikker fra DCU E-serien – sprintdata, placeringer og sæsonudvikling på Zwift.",
    url: "/stats",
  },
};

export default function StatsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
