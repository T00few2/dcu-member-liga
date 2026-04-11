import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tilmelding",
  description: "Tilmeld dig DCU forårsliga. Du skal have aktiv DCU-licens og en Zwift-konto for at deltage.",
  openGraph: {
    title: "Tilmelding – DCU forårsliga",
    description: "Tilmeld dig DCU forårsliga. Du skal have aktiv DCU-licens og en Zwift-konto for at deltage.",
    url: "/register",
  },
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
