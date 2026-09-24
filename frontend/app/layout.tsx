import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import AppChrome from "@/components/layout/AppChrome";

const inter = Inter({ subsets: ["latin"] });

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://www.dansk-ecykling.dk";
const socialImagePath = process.env.NEXT_PUBLIC_SOCIAL_IMAGE || "/social-share.png";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "DCU E-serien",
    template: "%s | DCU E-serien",
  },
  description: "E-cycling for DCU-medlemmer. Kør virtuelle løb på Zwift og konkurrér i DCU E-serien.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "DCU E-serien",
  },
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    type: "website",
    siteName: "DCU E-serien",
    title: "DCU E-serien",
    description: "E-cycling for DCU-medlemmer. Kør virtuelle løb på Zwift og konkurrér i DCU E-serien.",
    locale: "da_DK",
    url: siteUrl,
    images: [
      {
        url: socialImagePath,
        width: 1200,
        height: 630,
        alt: "DCU E-serien",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "DCU E-serien",
    description: "E-cycling for DCU-medlemmer. Kør virtuelle løb på Zwift og konkurrér i DCU E-serien.",
    images: [socialImagePath],
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SportsOrganization",
  name: "DCU E-serien",
  url: siteUrl,
  description: "E-cycling for DCU-medlemmer. Kør virtuelle løb på Zwift og konkurrér i DCU E-serien.",
  sport: "Cycling",
  logo: `${siteUrl}/icon-512.png`,
  sameAs: ["https://www.cycling.dk"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="da">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className={`${inter.className} overflow-x-hidden`}>
        <AppChrome>{children}</AppChrome>
      </body>
    </html>
  );
}
