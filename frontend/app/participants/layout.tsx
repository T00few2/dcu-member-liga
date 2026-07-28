import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Deltagere",
  description: "Liste over tilmeldte ryttere i DCU E-serien med kategori og klubtilhørsforhold.",
  openGraph: {
    title: "Deltagere – DCU E-serien",
    description: "Liste over tilmeldte ryttere i DCU E-serien med kategori og klubtilhørsforhold.",
    url: "/participants",
  },
};

export default function ParticipantsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
