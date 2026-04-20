import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import Image from "next/image";
import { AuthProvider } from "@/lib/auth-context";
import Navbar from "@/components/Navbar";
import ToastProvider from "@/components/ToastProvider";
import InAppBrowserBanner from "@/components/InAppBrowserBanner";
import MobileInstallBanner from "@/components/MobileInstallBanner";
import NotificationPermissionBanner from "@/components/NotificationPermissionBanner";
import WeightVerificationModal from "@/components/WeightVerificationModal";
import DiscordButton from "@/components/DiscordButton";
import { Analytics } from "@vercel/analytics/next";

const inter = Inter({ subsets: ["latin"] });

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://www.dansk-ecykling.dk";
const socialImagePath = process.env.NEXT_PUBLIC_SOCIAL_IMAGE || "/social-share.png";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "DCU forårsliga",
    template: "%s | DCU forårsliga",
  },
  description: "E-cycling liga for DCU-medlemmer. Kør virtuelle løb på Zwift og konkurrér om ligaen.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "DCU forårsliga",
  },
  icons: {
    icon: "/favicon.svg",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    type: "website",
    siteName: "DCU forårsliga",
    title: "DCU forårsliga",
    description: "E-cycling liga for DCU-medlemmer. Kør virtuelle løb på Zwift og konkurrér om ligaen.",
    locale: "da_DK",
    url: siteUrl,
    images: [
      {
        url: socialImagePath,
        width: 1024,
        height: 576,
        alt: "DCU forårsliga",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "DCU forårsliga",
    description: "E-cycling liga for DCU-medlemmer. Kør virtuelle løb på Zwift og konkurrér om ligaen.",
    images: [socialImagePath],
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SportsOrganization",
  name: "DCU forårsliga",
  url: siteUrl,
  description: "E-cycling liga for DCU-medlemmer. Kør virtuelle løb på Zwift og konkurrér om ligaen.",
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
        <AuthProvider>
          <ToastProvider>
            <InAppBrowserBanner />
            <MobileInstallBanner />
            <NotificationPermissionBanner />
            <WeightVerificationModal />
            <DiscordButton />
            <Navbar />
            <main className="min-h-screen">
              {children}
            </main>
            <footer className="site-footer bg-[#0e2029] relative overflow-hidden text-slate-300 text-sm py-5 mt-0">
              {/* Decorative Blue Blobs */}
              <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/4 w-[200px] h-[150px] bg-[#142d3a] rounded-[50px] pointer-events-none z-0 -rotate-12"></div>
              <div className="absolute bottom-0 left-0 translate-y-1/3 -translate-x-1/4 w-[200px] h-[150px] bg-[#142d3a] rounded-full pointer-events-none z-0 rotate-12"></div>

              <div className="relative z-10 flex flex-wrap gap-4 items-center justify-between container mx-auto px-4">
                <div className="flex items-center text-white font-bold tracking-wide gap-1">
                  <Image src="/DCU_logo_white.svg" alt="DCU Logo" width={20} height={20} />
                  DCU forårsliga
                </div>

                <div className="flex gap-4 font-semibold text-slate-400 ml-auto">
                  <Link href="/datapolitik" className="hover:text-white transition-colors">
                    Datapolitik
                  </Link>
                  <Link href="/offentliggoerelse" className="hover:text-white transition-colors">
                    Offentliggørelse
                  </Link>
                </div>

              </div>
            </footer>
          </ToastProvider>
        </AuthProvider>
        <Analytics />
      </body>
    </html>
  );
}
