import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Løbskalender",
  description: "Oversigt over kommende og afviklede løb i DCU forårsliga. Find datoer, ruter og kategorier for hvert løb.",
  openGraph: {
    title: "Løbskalender – DCU forårsliga",
    description: "Oversigt over kommende og afviklede løb i DCU forårsliga. Find datoer, ruter og kategorier for hvert løb.",
    url: "/schedule",
  },
};

export default function ScheduleLayout({ children }: { children: React.ReactNode }) {
  return children;
}
