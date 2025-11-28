'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';

interface Participant {
  name: string;
  eLicense: string;
  zwiftId?: string;
  category: string;
  ftp: number | string;
  rating: number | string;
  max30Rating: number | string;
  max90Rating: number | string;
  phenotype: string;
  racingScore: number | string;
  stravaKms: string;
}

export default function ParticipantsPage() {
  const { user, loading: authLoading, isRegistered } = useAuth();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !user) {
        router.push('/');
        return;
    }
    if (!authLoading && user && !isRegistered) {
        router.push('/register');
        return;
    }
  }, [user, authLoading, isRegistered, router]);

  useEffect(() => {
    if (!user || !isRegistered) return;

    const fetchParticipants = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
        const res = await fetch(`${apiUrl}/participants`);
        
        if (res.ok) {
          const data = await res.json();
          setParticipants(data.participants || []);
        } else {
          setError('Could not fetch participants');
        }
      } catch (e) {
         setError('Network error');
      } finally {
        setLoading(false);
      }
    };

    fetchParticipants();
  }, [user, isRegistered]);

  if (authLoading || loading) return <div className="p-8 text-center text-muted-foreground">Loading participants...</div>;

  if (error) return <div className="p-8 text-center text-red-600">{error}</div>;

  return (
    <div className="max-w-7xl mx-auto mt-8 px-4">
      <h1 className="text-3xl font-bold mb-2 text-foreground">Participants</h1>
      <p className="text-muted-foreground mb-8">All registered riders in the league.</p>
      
      <div className="bg-card rounded-lg shadow overflow-hidden border border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-muted-foreground">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground border-b border-border">
              <tr>
                <th className="px-6 py-3 font-bold">Name</th>
                <th className="px-6 py-3 font-bold">Cat</th>
                <th className="px-6 py-3 font-bold">FTP (ZP)</th>
                <th className="px-6 py-3 font-bold">ZRS</th>
                <th className="px-6 py-3 font-bold">vELO</th>
                <th className="px-6 py-3 font-bold">vELO max30</th>
                <th className="px-6 py-3 font-bold">vELO max90</th>
                <th className="px-6 py-3 font-bold">Phenotype</th>
              <th className="px-6 py-3 font-bold">Strava (10 rides)</th>
              <th className="px-6 py-3 font-bold">Profile Links</th>
              <th className="px-6 py-3 font-bold text-right">E-License</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {participants.length === 0 ? (
                  <tr>
                      <td colSpan={9} className="px-6 py-8 text-center text-muted-foreground">
                          No participants found yet.
                      </td>
                  </tr>
              ) : (
                  participants.map((p) => (
                    <tr key={p.eLicense} className="hover:bg-muted/50 transition">
                      <td className="px-6 py-4 font-medium text-card-foreground">{p.name}</td>
                      <td className="px-6 py-4">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium
                              ${p.category === 'A' ? 'bg-red-100 text-red-800' : 
                                p.category === 'B' ? 'bg-green-100 text-green-800' : 
                                p.category === 'C' ? 'bg-blue-100 text-blue-800' : 
                                'bg-slate-100 text-slate-800'}`}>
                              {p.category}
                          </span>
                      </td>
                      <td className="px-6 py-4">{p.ftp !== 'N/A' ? `${p.ftp} W` : '-'}</td>
                      <td className="px-6 py-4 font-mono font-medium text-card-foreground">
                          {p.racingScore !== 'N/A' && p.racingScore ? Math.round(Number(p.racingScore)) : '-'}
                      </td>
                      <td className="px-6 py-4 font-mono font-medium text-card-foreground">
                          {p.rating !== 'N/A' ? Math.round(Number(p.rating)) : '-'}
                      </td>
                      <td className="px-6 py-4 font-mono text-muted-foreground">
                          {p.max30Rating !== 'N/A' ? Math.round(Number(p.max30Rating)) : '-'}
                      </td>
                      <td className="px-6 py-4 font-mono text-muted-foreground">
                          {p.max90Rating !== 'N/A' ? Math.round(Number(p.max90Rating)) : '-'}
                      </td>
                      <td className="px-6 py-4">
                          {p.phenotype !== 'N/A' ? p.phenotype : '-'}
                      </td>
                      <td className="px-6 py-4">
                          {p.stravaKms !== '-' ? (
                              <span className="text-orange-600 flex items-center gap-1">
                                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/></svg>
                                  {p.stravaKms}
                              </span>
                          ) : '-'}
                      </td>
                      <td className="px-6 py-4">
                          {p.zwiftId ? (
                              <div className="flex items-center gap-3">
                                <a 
                                  href={`https://zwiftpower.com/profile.php?z=${p.zwiftId}`} 
                                  target="_blank" 
                                  rel="noopener noreferrer" 
                                  className="text-blue-500 hover:text-blue-600 transition-colors"
                                  title="ZwiftPower Profile"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                                  </svg>
                                </a>
                                <a 
                                  href={`https://www.zwiftracing.app/riders/${p.zwiftId}`} 
                                  target="_blank" 
                                  rel="noopener noreferrer" 
                                  className="text-purple-500 hover:text-purple-600 transition-colors"
                                  title="ZwiftRacing Profile"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="18" y1="20" x2="18" y2="10"></line>
                                    <line x1="12" y1="20" x2="12" y2="4"></line>
                                    <line x1="6" y1="20" x2="6" y2="14"></line>
                                  </svg>
                                </a>
                              </div>
                          ) : '-'}
                      </td>
                      <td className="px-6 py-4 text-muted-foreground text-right font-mono">{p.eLicense}</td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
