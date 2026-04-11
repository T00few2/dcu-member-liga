import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Resultater & Stillinger",
  description: "Se aktuelle ligastillinger og løbsresultater fra DCU forårsliga. Pointoversigt fordelt på rytterkategorier.",
  openGraph: {
    title: "Resultater & Stillinger – DCU forårsliga",
    description: "Se aktuelle ligastillinger og løbsresultater fra DCU forårsliga. Pointoversigt fordelt på rytterkategorier.",
    url: "/results",
  },
};

export default function ResultsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
