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
import { usePathname, useRouter } from 'next/navigation';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isRegistered: boolean;
  isAdmin: boolean;
  needsConsentUpdate: boolean;
  requiredDataPolicyVersion: string | null;
  requiredPublicResultsConsentVersion: string | null;
  signInWithGoogle: () => Promise<void>;
  logOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  refreshClaims: () => Promise<void>;
  isImpersonating: boolean;
  toggleImpersonation: () => void;
  weightVerificationStatus: 'none' | 'pending' | 'submitted' | 'approved' | 'rejected';
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  isRegistered: false,
  isAdmin: false,
  needsConsentUpdate: false,
  requiredDataPolicyVersion: null,
  requiredPublicResultsConsentVersion: null,
  signInWithGoogle: async () => { },
  logOut: async () => { },
  refreshProfile: async () => { },
  refreshClaims: async () => { },
  isImpersonating: false,
  toggleImpersonation: () => { },
  weightVerificationStatus: 'none',
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRegistered, setIsRegistered] = useState(false);
  const [realIsAdmin, setRealIsAdmin] = useState(false);
  const [isImpersonating, setIsImpersonating] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('isImpersonating') === 'true';
    }
    return false;
  });
  const isAdmin = realIsAdmin && !isImpersonating;
  const [needsConsentUpdate, setNeedsConsentUpdate] = useState(false);
  const [requiredDataPolicyVersion, setRequiredDataPolicyVersion] = useState<string | null>(null);
  const [requiredPublicResultsConsentVersion, setRequiredPublicResultsConsentVersion] = useState<string | null>(null);
  const [weightVerificationStatus, setWeightVerificationStatus] = useState<'none' | 'pending' | 'submitted' | 'approved' | 'rejected'>('none');
  const router = useRouter();
  const pathname = usePathname();

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
        setWeightVerificationStatus(data.weightVerificationStatus || 'none');
        // Consent gate: backend is source of truth for required versions.
        const requiredPolicy = data.requiredDataPolicyVersion;
        const requiredPublic = data.requiredPublicResultsConsentVersion;

        setRequiredDataPolicyVersion(requiredPolicy || null);
        setRequiredPublicResultsConsentVersion(requiredPublic || null);

        // Strict check: User must have accepted specific version required by system
        // Note: We check 'registration.dataPolicy.version' or fallback to root for legacy if needed,
        // but since we are cleaning up, we should look at what fetchProfile returns.
        // The fetchProfile route already maps this for us.

        const policyOk = !!requiredPolicy && (data.dataPolicyVersion === requiredPolicy) && !!data.acceptedDataPolicy;
        const publicOk = !!requiredPublic && (data.publicResultsConsentVersion === requiredPublic) && !!data.acceptedPublicResults;

        setNeedsConsentUpdate(!(policyOk && publicOk));
      } else {
        setIsRegistered(false);
        setNeedsConsentUpdate(false);
        setRequiredDataPolicyVersion(null);
        setRequiredPublicResultsConsentVersion(null);
      }
    } catch (error) {
      console.error("Error fetching profile:", error);
      setIsRegistered(false);
      setNeedsConsentUpdate(false);
      setRequiredDataPolicyVersion(null);
      setRequiredPublicResultsConsentVersion(null);
    }
  }, []);

  const fetchClaims = useCallback(async (currentUser: User) => {
    try {
      const tokenResult = await currentUser.getIdTokenResult();
      setRealIsAdmin(tokenResult?.claims?.admin === true);
    } catch (error) {
      console.error("Error fetching token claims:", error);
      setRealIsAdmin(false);
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
        setRealIsAdmin(false);
        setIsImpersonating(false);
        localStorage.removeItem('isImpersonating');
        setNeedsConsentUpdate(false);
        setRequiredDataPolicyVersion(null);
        setRequiredPublicResultsConsentVersion(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [fetchProfile, fetchClaims]);

  // Global consent gate: if signed in and consents are outdated, redirect to /consent.
  // Allow accessing /consent and policy pages so user can review and accept.
  useEffect(() => {
    if (loading) return;
    if (!user) return;
    if (!needsConsentUpdate) return;

    const allowed = pathname === '/consent' || pathname === '/datapolitik' || pathname === '/offentliggoerelse';
    if (!allowed) {
      router.push('/consent');
    }
  }, [loading, user, needsConsentUpdate, pathname, router]);

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

  const toggleImpersonation = useCallback(() => {
    if (realIsAdmin) {
      setIsImpersonating(prev => {
        const newValue = !prev;
        if (newValue) {
          localStorage.setItem('isImpersonating', 'true');
        } else {
          localStorage.removeItem('isImpersonating');
        }
        return newValue;
      });
    }
  }, [realIsAdmin]);

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
      setRealIsAdmin(false);
      setIsImpersonating(false);
      localStorage.removeItem('isImpersonating');
      setNeedsConsentUpdate(false);
      setRequiredDataPolicyVersion(null);
      setRequiredPublicResultsConsentVersion(null);
    } catch (error) {
      console.error("Error signing out", error);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, isRegistered, isAdmin, needsConsentUpdate, requiredDataPolicyVersion, requiredPublicResultsConsentVersion, signInWithGoogle, logOut, refreshProfile, refreshClaims, isImpersonating, toggleImpersonation, weightVerificationStatus }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
