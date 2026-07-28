import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Verifikation",
  description: "Se din vægt- og dual recording verifikationsstatus.",
  openGraph: {
    title: "Verifikation – DCU E-serien",
    description: "Se din vægt- og dual recording verifikationsstatus.",
    url: "/verification",
  },
};

export default function VerificationLayout({ children }: { children: React.ReactNode }) {
  return children;
}
