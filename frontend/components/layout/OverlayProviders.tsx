import { AuthProvider } from '@/lib/auth-context';
import { ReactQueryProvider } from '@/lib/query-provider';
import ToastProvider from '@/components/ToastProvider';

/** Minimal providers for OBS overlay URLs — no navbar, footer, banners, or Analytics. */
export default function OverlayProviders({ children }: { children: React.ReactNode }) {
    return (
        <ReactQueryProvider>
            <ToastProvider>
                <AuthProvider>
                    {children}
                </AuthProvider>
            </ToastProvider>
        </ReactQueryProvider>
    );
}
