import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Link from "next/link";

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
        <nav className="bg-slate-900 text-white p-4">
          <div className="container mx-auto flex justify-between items-center">
            <Link href="/" className="text-xl font-bold">DCU League</Link>
            <div className="space-x-4">
              <Link href="/signup" className="hover:text-slate-300">Sign Up</Link>
              <Link href="/stats" className="hover:text-slate-300">Stats</Link>
              <Link href="/results" className="hover:text-slate-300">Results</Link>
            </div>
          </div>
        </nav>
        <main className="container mx-auto p-4 min-h-screen">
          {children}
        </main>
        <footer className="bg-slate-100 p-4 text-center text-slate-600 text-sm">
          © {new Date().getFullYear()} DCU Member League
        </footer>
      </body>
    </html>
  );
}
