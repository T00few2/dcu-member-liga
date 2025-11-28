'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';

interface Participant {
  name: string;
  eLicense: string;
  category: string;
  ftp: number | string;
  rating: number | string;
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
    <div className="max-w-6xl mx-auto mt-8 px-4">
      <h1 className="text-3xl font-bold mb-2 text-slate-800">Participants</h1>
      <p className="text-slate-600 mb-8">All registered riders in the league.</p>
      
      <div className="bg-white rounded-lg shadow overflow-hidden border border-slate-200">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 text-xs uppercase text-slate-700 border-b border-slate-200">
              <tr>
                <th className="px-6 py-3 font-bold">Name</th>
                <th className="px-6 py-3 font-bold">Category</th>
                <th className="px-6 py-3 font-bold">FTP</th>
                <th className="px-6 py-3 font-bold">Rating (ZR)</th>
                <th className="px-6 py-3 font-bold">E-License</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {participants.length === 0 ? (
                  <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-slate-500">
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
                      <td className="px-6 py-4 font-mono">{p.rating !== 'N/A' ? Math.round(Number(p.rating)) : '-'}</td>
                      <td className="px-6 py-4 text-slate-400">{p.eLicense}</td>
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

