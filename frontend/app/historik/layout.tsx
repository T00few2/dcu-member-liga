import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Historik",
  description: "Arkiverede resultater og stillinger fra tidligere sæsoner af DCU forårsliga.",
  openGraph: {
    title: "Historik – DCU forårsliga",
    description: "Arkiverede resultater og stillinger fra tidligere sæsoner af DCU forårsliga.",
    url: "/historik",
  },
};

export default function HistorikLayout({ children }: { children: React.ReactNode }) {
  return children;
}
