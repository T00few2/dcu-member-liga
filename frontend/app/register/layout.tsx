import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tilmelding",
  description: "Tilmeld dig DCU E-serien. Du skal være medlem af en DCU-klub og have en Zwift-konto for at deltage.",
  openGraph: {
    title: "Tilmelding – DCU E-serien",
    description: "Tilmeld dig DCU E-serien. Du skal være medlem af en DCU-klub og have en Zwift-konto for at deltage.",
    url: "/register",
  },
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
