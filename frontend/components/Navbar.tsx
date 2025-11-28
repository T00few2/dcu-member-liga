'use client';

import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useState } from "react";

export default function Navbar() {
  const { user, signInWithGoogle, logOut, loading } = useAuth();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <nav className="bg-slate-900 text-white p-4">
      <div className="container mx-auto flex justify-between items-center">
        <Link href="/" className="text-xl font-bold">DCU League</Link>
        
        <div className="flex items-center gap-4">
          {!loading && (
            <>
              {user ? (
                <div className="flex items-center gap-4">
                  {/* Navigation Links for Authenticated Users */}
                  <Link href="/stats" className="hover:text-slate-300 hidden md:block">Stats</Link>
                  <Link href="/results" className="hover:text-slate-300 hidden md:block">Results</Link>
                  
                  {/* User Menu */}
                  <div className="relative">
                    <button 
                      onClick={() => setIsMenuOpen(!isMenuOpen)}
                      className="flex items-center gap-2 hover:text-slate-300 focus:outline-none"
                    >
                      {user.photoURL ? (
                        <img 
                          src={user.photoURL} 
                          alt={user.displayName || 'User'} 
                          className="w-8 h-8 rounded-full border border-slate-600"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
                          {user.email?.[0].toUpperCase()}
                        </div>
                      )}
                    </button>

                    {isMenuOpen && (
                      <div className="absolute right-0 mt-2 w-48 bg-white text-slate-900 rounded shadow-lg py-1 z-50">
                        <div className="px-4 py-2 border-b border-slate-100 text-sm font-medium">
                          {user.displayName || user.email}
                        </div>
                        <Link 
                          href="/register" 
                          className="block px-4 py-2 text-sm hover:bg-slate-50"
                          onClick={() => setIsMenuOpen(false)}
                        >
                          My Profile
                        </Link>
                        <button 
                          onClick={() => {
                            logOut();
                            setIsMenuOpen(false);
                          }}
                          className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-slate-50"
                        >
                          Log Out
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <button 
                  onClick={signInWithGoogle}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-medium transition-colors"
                >
                  Log In
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

