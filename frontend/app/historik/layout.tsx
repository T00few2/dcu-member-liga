import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Historik",
  description: "Arkiverede resultater og stillinger fra tidligere sæsoner af DCU E-serien.",
  openGraph: {
    title: "Historik – DCU E-serien",
    description: "Arkiverede resultater og stillinger fra tidligere sæsoner af DCU E-serien.",
    url: "/historik",
  },
};

export default function HistorikLayout({ children }: { children: React.ReactNode }) {
  return children;
}
