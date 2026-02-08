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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AuthProvider>
          <ToastProvider>
            <WeightVerificationModal />
            <Navbar />
            <main className="container mx-auto p-4 min-h-screen">
              {children}
            </main>
            <footer className="site-footer bg-slate-100 p-4 text-center text-slate-600 text-sm">
              <div className="flex flex-col gap-2 items-center justify-center">
                <div>
                  © {new Date().getFullYear()} DCU Member League
                </div>
                <div className="flex gap-4">
                  <Link href="/datapolitik" className="hover:underline">
                    Datapolitik
                  </Link>
                  <Link href="/offentliggoerelse" className="hover:underline">
                    Offentliggørelse
                  </Link>
                </div>
              </div>
            </footer>
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
