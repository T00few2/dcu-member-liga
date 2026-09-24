import Link from 'next/link';
import Image from 'next/image';
import { AuthProvider } from '@/lib/auth-context';
import { ReactQueryProvider } from '@/lib/query-provider';
import Navbar from '@/components/Navbar';
import ToastProvider from '@/components/ToastProvider';
import InAppBrowserBanner from '@/components/InAppBrowserBanner';
import MobileInstallBanner from '@/components/MobileInstallBanner';
import NotificationPermissionBanner from '@/components/NotificationPermissionBanner';
import WeightVerificationModal from '@/components/WeightVerificationModal';
import AppBadgeSync from '@/components/AppBadgeSync';
import DiscordButton from '@/components/DiscordButton';
import { Analytics } from '@vercel/analytics/next';

export default function SiteShell({ children }: { children: React.ReactNode }) {
    return (
        <>
            <ReactQueryProvider>
                <ToastProvider>
                    <AuthProvider>
                        <InAppBrowserBanner />
                        <MobileInstallBanner />
                        <NotificationPermissionBanner />
                        <WeightVerificationModal />
                        <AppBadgeSync />
                        <DiscordButton />
                        <Navbar />
                        <main className="min-h-screen">
                            {children}
                        </main>
                        <footer className="site-footer bg-[#0e2029] relative overflow-hidden text-slate-300 text-sm py-5 mt-0">
                            <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/4 w-[200px] h-[150px] bg-[#142d3a] rounded-[50px] pointer-events-none z-0 -rotate-12"></div>
                            <div className="absolute bottom-0 left-0 translate-y-1/3 -translate-x-1/4 w-[200px] h-[150px] bg-[#142d3a] rounded-full pointer-events-none z-0 rotate-12"></div>

                            <div className="relative z-10 flex flex-wrap gap-4 items-center justify-between container mx-auto px-4">
                                <div className="flex items-center text-white font-bold tracking-wide gap-1">
                                    <Image src="/DCU_logo_white.svg" alt="DCU Logo" width={20} height={20} />
                                    DCU E-serien
                                </div>

                                <div className="flex gap-4 font-semibold text-slate-400 ml-auto">
                                    <Link prefetch={false} href="/datapolitik" className="hover:text-white transition-colors">
                                        Datapolitik
                                    </Link>
                                    <Link prefetch={false} href="/offentliggoerelse" className="hover:text-white transition-colors">
                                        Offentliggørelse
                                    </Link>
                                </div>
                            </div>
                        </footer>
                    </AuthProvider>
                </ToastProvider>
            </ReactQueryProvider>
            <Analytics />
        </>
    );
}
