import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Deltagere",
  description: "Liste over tilmeldte ryttere i DCU forårsliga med kategori og klubtilhørsforhold.",
  openGraph: {
    title: "Deltagere – DCU forårsliga",
    description: "Liste over tilmeldte ryttere i DCU forårsliga med kategori og klubtilhørsforhold.",
    url: "/participants",
  },
};

export default function ParticipantsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
