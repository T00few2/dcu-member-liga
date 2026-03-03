import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import { AuthProvider } from "@/lib/auth-context";
import Navbar from "@/components/Navbar";
import ToastProvider from "@/components/ToastProvider";
import WeightVerificationModal from "@/components/WeightVerificationModal";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "DCU Member League",
  description: "E-cycling league for DCU members",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "DCU League",
  },
  icons: {
    apple: "/app_icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="da">
      <body className={`${inter.className} overflow-x-hidden`}>
        <AuthProvider>
          <ToastProvider>
            <WeightVerificationModal />
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
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                  DCU Member League
                </div>

                <div className="flex gap-4 font-semibold text-slate-400 ml-auto">
                  <Link href="/datapolitik" className="hover:text-white transition-colors">
                    Datapolitik
                  </Link>
                  <Link href="/offentliggoerelse" className="hover:text-white transition-colors">
                    Offentliggørelse
                  </Link>
                </div>

                <div className="text-slate-500 whitespace-nowrap">
                  © {new Date().getFullYear()} Danmarks Cykle Union
                </div>
              </div>
            </footer>
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
