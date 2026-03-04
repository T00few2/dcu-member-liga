'use client';

import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";

export default function Navbar() {
    const { user, signInWithGoogle, logOut, loading, isRegistered, needsConsentUpdate, isImpersonating, toggleImpersonation, isAdmin, weightVerificationStatus } = useAuth();
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const pathname = usePathname();
    const hideNavbar = pathname?.startsWith('/live');

    // Close drawer when route changes
    useEffect(() => {
        setIsDrawerOpen(false);
        setIsMenuOpen(false);
    }, [pathname]);

    // Prevent scrolling when drawer is open
    useEffect(() => {
        if (isDrawerOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, [isDrawerOpen]);

    const publicNavLinks = [
        { href: '/info', label: 'Info' },
    ];

    const authNavLinks = [
        { href: '/participants', label: 'Deltagere' },
        { href: '/schedule', label: 'Kalender' },
        { href: '/results', label: 'Resultater' },
        { href: '/stats', label: 'Statistik' },
    ];

    if (hideNavbar) return null;

    return (
        <>
            <nav className="bg-primary text-white p-4 sticky top-0 z-40 shadow-md">
                <div className="container mx-auto flex justify-between items-center">

                    <div className="flex items-center gap-4">
                        {/* Mobile Menu Button */}
                        <button
                            onClick={() => setIsDrawerOpen(true)}
                            className="md:hidden text-white p-1 -ml-2 hover:bg-slate-800 rounded focus:outline-none"
                            aria-label="Open menu"
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                            </svg>
                        </button>

                        <div className="flex items-center gap-6">
                            <Link href="/" className="text-xl font-bold">DCU Member League</Link>

                            {/* Public Desktop Navigation Links */}
                            <div className="hidden md:flex items-center gap-6">
                                {publicNavLinks.map(link => (
                                    <Link
                                        key={link.href}
                                        href={link.href}
                                        className={`hover:bg-white/10 px-3 py-2 rounded-md text-base transition-colors flex items-center gap-2 ${pathname === link.href ? 'text-white font-bold' : 'text-white/90 font-bold'}`}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        {link.label}
                                    </Link>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        {!loading && (
                            <>
                                {user ? (
                                    <div className="flex items-center gap-4">
                                        {/* Desktop Navigation Links */}
                                        {isRegistered && !needsConsentUpdate && (
                                            <div className="hidden md:flex items-center gap-6">
                                                {authNavLinks.map(link => (
                                                    <Link
                                                        key={link.href}
                                                        href={link.href}
                                                        className={`hover:bg-white/10 px-3 py-2 rounded-md text-base transition-colors ${pathname === link.href ? 'text-white font-bold' : 'text-white/90 font-bold'
                                                            }`}
                                                    >
                                                        {link.label}
                                                    </Link>
                                                ))}
                                            </div>
                                        )}

                                        {/* User Menu Dropdown (Desktop & Mobile) */}
                                        <div className="relative">
                                            <button
                                                onClick={() => setIsMenuOpen(!isMenuOpen)}
                                                className="flex items-center gap-2 hover:text-slate-300 focus:outline-none relative"
                                            >
                                                {user.photoURL ? (
                                                    <img
                                                        src={user.photoURL}
                                                        alt={user.displayName || 'User'}
                                                        className="w-8 h-8 rounded-full border border-slate-600"
                                                    />
                                                ) : (
                                                    <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                                                        {user.email?.[0].toUpperCase()}
                                                    </div>
                                                )}
                                                {/* Notification Badge */}
                                                {(weightVerificationStatus === 'pending' || weightVerificationStatus === 'rejected') && (
                                                    <span className="absolute -top-1 -right-1 flex h-3 w-3">
                                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-tertiary opacity-75"></span>
                                                        <span className="relative inline-flex rounded-full h-3 w-3 bg-tertiary"></span>
                                                    </span>
                                                )}
                                            </button>

                                            {isMenuOpen && (
                                                <>
                                                    {/* Backdrop for dropdown click-away */}
                                                    <div
                                                        className="fixed inset-0 z-40"
                                                        onClick={() => setIsMenuOpen(false)}
                                                    />
                                                    <div className="absolute right-0 mt-2 w-48 bg-white text-slate-900 rounded shadow-lg py-1 z-50 animate-in fade-in zoom-in-95 duration-100">
                                                        <div className="px-4 py-2 border-b border-slate-100 text-sm font-medium truncate">
                                                            {user.displayName || user.email}
                                                        </div>
                                                        {/* Admin Impersonation Toggle - Only show if user has actual admin claim */}
                                                        {(isAdmin || isImpersonating) && (
                                                            <button
                                                                onClick={() => {
                                                                    toggleImpersonation();
                                                                    setIsMenuOpen(false);
                                                                }}
                                                                className={`block w-full text-left px-4 py-2 text-sm hover:bg-slate-50 border-b border-slate-100 ${isImpersonating ? 'text-tertiary font-bold' : 'text-primary'
                                                                    }`}
                                                            >
                                                                {isImpersonating ? 'Afslut brugervisning' : 'Vis som bruger'}
                                                            </button>
                                                        )}
                                                        <Link
                                                            href="/register"
                                                            className="block px-4 py-2 text-sm hover:bg-slate-50 flex items-center justify-between"
                                                            onClick={() => setIsMenuOpen(false)}
                                                        >
                                                            <span>Min Profil</span>
                                                            {(weightVerificationStatus === 'pending' || weightVerificationStatus === 'rejected') && (
                                                                <span className="h-2 w-2 rounded-full bg-tertiary"></span>
                                                            )}
                                                        </Link>
                                                        <button
                                                            onClick={() => {
                                                                logOut();
                                                                setIsMenuOpen(false);
                                                            }}
                                                            className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-slate-50"
                                                        >
                                                            Log ud
                                                        </button>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <button
                                        onClick={signInWithGoogle}
                                        className="bg-primary hover:bg-primary-dark text-primary-foreground px-4 py-2 rounded text-sm font-bold transition-colors"
                                    >
                                        Log ind
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </nav>

            {/* Mobile Side Drawer */}
            <>
                {/* Backdrop */}
                <div
                    className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 md:hidden ${isDrawerOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
                        }`}
                    onClick={() => setIsDrawerOpen(false)}
                />

                {/* Drawer Panel */}
                <div
                    className={`fixed top-0 left-0 h-full w-64 bg-slate-900 text-white z-50 transform transition-transform duration-300 ease-in-out shadow-2xl md:hidden ${isDrawerOpen ? 'translate-x-0' : '-translate-x-full'
                        }`}
                >
                    <div className="p-4 border-b border-slate-800 flex justify-between items-center">
                        <span className="font-bold text-lg">Menu</span>
                        <button
                            onClick={() => setIsDrawerOpen(false)}
                            className="text-slate-400 hover:text-white"
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    <div className="flex flex-col p-4 space-y-4">
                        {publicNavLinks.map(link => (
                            <Link
                                key={link.href}
                                href={link.href}
                                className={`px-4 py-3 rounded-lg transition-colors flex items-center gap-2 ${pathname === link.href
                                    ? 'bg-primary text-primary-foreground font-medium'
                                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                                    }`}
                                onClick={() => setIsDrawerOpen(false)}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                {link.label}
                            </Link>
                        ))}

                        {user && isRegistered && !needsConsentUpdate && authNavLinks.map(link => (
                            <Link
                                key={link.href}
                                href={link.href}
                                className={`px-4 py-3 rounded-lg transition-colors ${pathname === link.href
                                    ? 'bg-primary text-primary-foreground font-medium'
                                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                                    }`}
                                onClick={() => setIsDrawerOpen(false)}
                            >
                                {link.label}
                            </Link>
                        ))}

                        {user ? (
                            <div className="border-t border-slate-800 pt-4 mt-4">
                                <Link
                                    href="/register"
                                    className="block px-4 py-3 text-slate-300 hover:bg-slate-800 hover:text-white rounded-lg"
                                    onClick={() => setIsDrawerOpen(false)}
                                >
                                    Min Profil
                                </Link>
                                <button
                                    onClick={() => {
                                        logOut();
                                        setIsDrawerOpen(false);
                                    }}
                                    className="w-full text-left px-4 py-3 text-red-400 hover:bg-slate-800 hover:text-red-300 rounded-lg"
                                >
                                    Log ud
                                </button>
                            </div>
                        ) : (
                            <div className="border-t border-slate-800 pt-4 mt-4">
                                <button
                                    onClick={() => {
                                        signInWithGoogle();
                                        setIsDrawerOpen(false);
                                    }}
                                    className="w-full text-left px-4 py-3 text-white hover:bg-slate-800 rounded-lg font-bold"
                                >
                                    Log ind
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </>
        </>
    );
}
