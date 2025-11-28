'use client';

import { useAuth } from "@/lib/auth-context";
import Link from "next/link";

export default function Home() {
  const { user, signInWithGoogle } = useAuth();

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <h1 className="text-4xl font-bold mb-4 text-foreground">Welcome to DCU Member League</h1>
      <p className="text-xl mb-8 max-w-2xl text-foreground opacity-80">
        The official e-cycling league for DCU members. Join the competition, view participants, and track race results.
      </p>
      
      {!user ? (
        <div className="bg-card text-card-foreground p-8 rounded-lg shadow-md border border-border max-w-md w-full">
          <h2 className="text-2xl font-semibold mb-4">Join the League</h2>
          <p className="text-muted-foreground mb-6">Sign in to register your license and view your stats.</p>
          <button 
            onClick={signInWithGoogle}
            className="w-full bg-primary text-primary-foreground py-3 px-4 rounded-lg font-medium hover:opacity-90 transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Sign in with Google
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-4xl">
          <Link href="/participants" className="p-6 border border-border rounded-lg shadow-sm hover:shadow-md transition bg-card text-card-foreground group text-left">
            <h2 className="text-2xl font-semibold mb-2 group-hover:text-primary">Participants &rarr;</h2>
            <p className="text-muted-foreground">
              Check out the competition.
            </p>
          </Link>
          
          <Link href="/results" className="p-6 border border-border rounded-lg shadow-sm hover:shadow-md transition bg-card text-card-foreground group text-left">
            <h2 className="text-2xl font-semibold mb-2 group-hover:text-primary">Results &rarr;</h2>
            <p className="text-muted-foreground">
              View race results and league standings.
            </p>
          </Link>
        </div>
      )}
    </div>
  );
}

