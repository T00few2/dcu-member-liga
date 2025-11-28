'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';

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
  const { user, loading: authLoading } = useAuth();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
  }, []);

  if (loading) return <div className="p-8 text-center">Loading participants...</div>;

  if (error) return <div className="p-8 text-center text-red-600">{error}</div>;

  return (
    <div className="max-w-7xl mx-auto mt-8 px-4">
      <h1 className="text-3xl font-bold mb-2 text-slate-800">Participants</h1>
      <p className="text-slate-600 mb-8">All registered riders in the league.</p>
      
      <div className="bg-white rounded-lg shadow overflow-hidden border border-slate-200">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 text-xs uppercase text-slate-700 border-b border-slate-200">
              <tr>
                <th className="px-6 py-3 font-bold">Name</th>
                <th className="px-6 py-3 font-bold">Cat</th>
                <th className="px-6 py-3 font-bold">FTP (ZP)</th>
                <th className="px-6 py-3 font-bold">ZRS</th>
                <th className="px-6 py-3 font-bold">vELO</th>
                <th className="px-6 py-3 font-bold hidden md:table-cell">vELO max30</th>
                <th className="px-6 py-3 font-bold hidden md:table-cell">vELO max90</th>
                <th className="px-6 py-3 font-bold hidden lg:table-cell">Phenotype</th>
                <th className="px-6 py-3 font-bold hidden lg:table-cell">Strava (10 rides)</th>
                <th className="px-6 py-3 font-bold hidden xl:table-cell">Links</th>
                <th className="px-6 py-3 font-bold text-right">E-License</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {participants.length === 0 ? (
                  <tr>
                      <td colSpan={9} className="px-6 py-8 text-center text-slate-500">
                          No participants found yet.
                      </td>
                  </tr>
              ) : (
                  participants.map((p) => (
                    <tr key={p.eLicense} className="hover:bg-slate-50 transition">
                      <td className="px-6 py-4 font-medium text-slate-900">{p.name}</td>
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
                      <td className="px-6 py-4 font-mono font-medium text-slate-900">
                          {p.racingScore !== 'N/A' && p.racingScore ? Math.round(Number(p.racingScore)) : '-'}
                      </td>
                      <td className="px-6 py-4 font-mono font-medium text-slate-900">
                          {p.rating !== 'N/A' ? Math.round(Number(p.rating)) : '-'}
                      </td>
                      <td className="px-6 py-4 font-mono text-slate-500 hidden md:table-cell">
                          {p.max30Rating !== 'N/A' ? Math.round(Number(p.max30Rating)) : '-'}
                      </td>
                      <td className="px-6 py-4 font-mono text-slate-500 hidden md:table-cell">
                          {p.max90Rating !== 'N/A' ? Math.round(Number(p.max90Rating)) : '-'}
                      </td>
                      <td className="px-6 py-4 hidden lg:table-cell">
                          {p.phenotype !== 'N/A' ? p.phenotype : '-'}
                      </td>
                      <td className="px-6 py-4 hidden lg:table-cell">
                          {p.stravaKms !== '-' ? (
                              <span className="text-orange-600 flex items-center gap-1">
                                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/></svg>
                                  {p.stravaKms}
                              </span>
                          ) : '-'}
                      </td>
                      <td className="px-6 py-4 hidden xl:table-cell flex gap-2">
                          {p.zwiftId ? (
                              <>
                                <a href={`https://zwiftpower.com/profile.php?z=${p.zwiftId}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 text-xs border border-blue-200 px-2 py-1 rounded bg-blue-50">ZP</a>
                                <a href={`https://www.zwiftracing.app/riders/${p.zwiftId}`} target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:text-purple-800 text-xs border border-purple-200 px-2 py-1 rounded bg-purple-50">ZR</a>
                              </>
                          ) : '-'}
                      </td>
                      <td className="px-6 py-4 text-slate-400 text-right font-mono">{p.eLicense}</td>
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
