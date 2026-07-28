import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Resultater & Stillinger",
  description: "Se aktuelle sæsonstilling og løbsresultater fra DCU E-serien. Pointoversigt fordelt på rytterkategorier.",
  openGraph: {
    title: "Resultater & Stillinger – DCU E-serien",
    description: "Se aktuelle sæsonstilling og løbsresultater fra DCU E-serien. Pointoversigt fordelt på rytterkategorier.",
    url: "/results",
  },
};

export default function ResultsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
