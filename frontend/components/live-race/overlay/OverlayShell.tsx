'use client';

/**
 * Full-bleed white canvas for the live-stream overlay pages.
 *
 * Covers the site chrome (navbar/banners) and hides the footer, so an OBS
 * browser source pointed at an overlay URL shows only the component itself.
 */
export default function OverlayShell({ children }: { children: React.ReactNode }) {
    return (
        <div className="fixed inset-0 z-50 overflow-auto bg-white text-[color:var(--foreground)]">
            <div className="p-2">{children}</div>

            <style jsx global>{`
                body { background-color: #ffffff; }
                .site-footer { display: none !important; }
            `}</style>
        </div>
    );
}
