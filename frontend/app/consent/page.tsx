'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

export default function ConsentPage() {
  const { user, loading, needsConsentUpdate, refreshProfile, requiredDataPolicyVersion, requiredPublicResultsConsentVersion } = useAuth();
  const router = useRouter();
  const [acceptedDataPolicy, setAcceptedDataPolicy] = useState(false);
  const [acceptedPublicResults, setAcceptedPublicResults] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!loading && !user) {
      router.push('/');
    }
  }, [loading, user, router]);

  useEffect(() => {
    // If user already compliant, bounce away.
    if (!loading && user && !needsConsentUpdate) {
      router.push('/');
    }
  }, [loading, user, needsConsentUpdate, router]);

  const handleSave = async () => {
    if (!user) return;
    setSubmitting(true);
    setError('');
    setMessage('');

    try {
      if (!acceptedDataPolicy || !acceptedPublicResults) {
        setError('Du skal acceptere begge punkter for at fortsætte.');
        return;
      }
      if (!requiredDataPolicyVersion || !requiredPublicResultsConsentVersion) {
        setError('Kunne ikke hente den nyeste version. Prøv igen om lidt.');
        return;
      }

      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
      const idToken = await user.getIdToken();
      const res = await fetch(`${apiUrl}/consents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          acceptedDataPolicy: true,
          dataPolicyVersion: requiredDataPolicyVersion,
          acceptedPublicResults: true,
          publicResultsConsentVersion: requiredPublicResultsConsentVersion,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Kunne ikke gemme samtykker.');

      setMessage('Tak — dine samtykker er gemt.');
      await refreshProfile();
      router.push('/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Der skete en fejl.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="p-8 text-center">Loading...</div>;
  if (!user) return null;

  return (
    <div className="max-w-2xl mx-auto mt-10 p-8 bg-card rounded-lg shadow-md border border-border">
      <h1 className="text-3xl font-bold mb-2 text-card-foreground">Opdaterede vilkår</h1>
      <p className="text-muted-foreground mb-6">
        Vi har opdateret vores datapolitik/vilkår. For at fortsætte skal du bekræfte de nyeste versioner.
      </p>

      {message && (
        <div className="bg-green-50 text-green-700 p-4 rounded-md mb-6 border border-green-200">
          {message}
        </div>
      )}
      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-md mb-6 border border-red-200">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <div className="p-4 border border-border rounded-lg bg-muted/10">
          <p className="font-semibold text-card-foreground mb-2">Datapolitik</p>
          <p className="text-sm text-muted-foreground mb-3">
            Læs{' '}
            <Link href="/datapolitik" className="text-primary hover:underline" target="_blank">
              datapolitikken
            </Link>
            {requiredDataPolicyVersion ? ` (version ${requiredDataPolicyVersion}).` : '.'}
          </p>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={acceptedDataPolicy}
              onChange={(e) => setAcceptedDataPolicy(e.target.checked)}
            />
            <span className="text-sm text-card-foreground">Jeg har læst og accepterer datapolitikken.</span>
          </label>
        </div>

        <div className="p-4 border border-border rounded-lg bg-muted/10">
          <p className="font-semibold text-card-foreground mb-2">Offentliggørelse</p>
          <p className="text-sm text-muted-foreground mb-3">
            Ligaen kan offentliggøre dit navn og dine resultater i forbindelse med resultater og stillinger. Læs{' '}
            <Link href="/offentliggoerelse" className="text-primary hover:underline" target="_blank">
              vilkårene
            </Link>
            {requiredPublicResultsConsentVersion ? ` (version ${requiredPublicResultsConsentVersion}).` : '.'}
          </p>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={acceptedPublicResults}
              onChange={(e) => setAcceptedPublicResults(e.target.checked)}
            />
            <span className="text-sm text-card-foreground">
              Jeg accepterer, at mit navn og mine resultater kan offentliggøres.
            </span>
          </label>
        </div>

        <button
          onClick={handleSave}
          disabled={submitting}
          className="w-full py-3 rounded-lg font-bold text-lg transition shadow-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Gemmer...' : 'Gem og fortsæt'}
        </button>
      </div>
    </div>
  );
}

