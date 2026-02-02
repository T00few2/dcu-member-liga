'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { 
  User, 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut as firebaseSignOut 
} from 'firebase/auth';
import { auth } from './firebase';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isRegistered: boolean;
  isAdmin: boolean;
  signInWithGoogle: () => Promise<void>;
  logOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  refreshClaims: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  isRegistered: false,
  isAdmin: false,
  signInWithGoogle: async () => {},
  logOut: async () => {},
  refreshProfile: async () => {},
  refreshClaims: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRegistered, setIsRegistered] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const fetchProfile = useCallback(async (currentUser: User) => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
      const idToken = await currentUser.getIdToken();
      const res = await fetch(`${apiUrl}/profile`, {
        headers: {
          'Authorization': `Bearer ${idToken}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setIsRegistered(!!data.registered);
      } else {
        setIsRegistered(false);
      }
    } catch (error) {
      console.error("Error fetching profile:", error);
      setIsRegistered(false);
    }
  }, []);

  const fetchClaims = useCallback(async (currentUser: User) => {
    try {
      const tokenResult = await currentUser.getIdTokenResult();
      setIsAdmin(tokenResult?.claims?.admin === true);
    } catch (error) {
      console.error("Error fetching token claims:", error);
      setIsAdmin(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      if (user) {
        await fetchProfile(user);
        await fetchClaims(user);
      } else {
        setIsRegistered(false);
        setIsAdmin(false);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [fetchProfile, fetchClaims]);

  const refreshProfile = async () => {
    if (user) {
      await fetchProfile(user);
    }
  };

  const refreshClaims = async () => {
    if (user) {
      // Force token refresh so newly set custom claims are picked up immediately.
      await user.getIdToken(true);
      await fetchClaims(user);
    }
  };

  const signInWithGoogle = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Error signing in with Google", error);
    }
  };

  const logOut = async () => {
    try {
      await firebaseSignOut(auth);
      setIsRegistered(false);
      setIsAdmin(false);
    } catch (error) {
      console.error("Error signing out", error);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, isRegistered, isAdmin, signInWithGoogle, logOut, refreshProfile, refreshClaims }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
