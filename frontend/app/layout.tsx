import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import { AuthProvider } from "@/lib/auth-context";
import Navbar from "@/components/Navbar";
import ToastProvider from "@/components/ToastProvider";

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
            <Navbar />
            <main className="container mx-auto p-4 min-h-screen">
              {children}
            </main>
            <footer className="site-footer bg-slate-100 p-4 text-center text-slate-600 text-sm">
              © {new Date().getFullYear()} DCU Member League
            </footer>
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
