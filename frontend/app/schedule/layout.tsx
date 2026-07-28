import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sæsonkalender",
  description: "Oversigt over kommende og afviklede løb i DCU E-serien. Find datoer, ruter og kategorier for hvert løb.",
  openGraph: {
    title: "Sæsonkalender – DCU E-serien",
    description: "Oversigt over kommende og afviklede løb i DCU E-serien. Find datoer, ruter og kategorier for hvert løb.",
    url: "/schedule",
  },
};

export default function ScheduleLayout({ children }: { children: React.ReactNode }) {
  return children;
}
