'use client';

import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';

function getZRCategory(rating: number | string): string {
  const r = Number(rating);
  if (isNaN(r) || rating === 'N/A') return '-';
  if (r >= 2200) return 'Diamond';
  if (r >= 1900) return 'Ruby';
  if (r >= 1650) return 'Emerald';
  if (r >= 1450) return 'Sapphire';
  if (r >= 1300) return 'Amethyst';
  if (r >= 1150) return 'Platinum';
  if (r >= 1000) return 'Gold';
  if (r >= 850) return 'Silver';
  if (r >= 650) return 'Bronze';
  return 'Copper';
}

const ZR_CATEGORY_STYLES: Record<string, string> = {
  Diamond: 'bg-cyan-100 text-cyan-800',
  Ruby: 'bg-red-100 text-red-800',
  Emerald: 'bg-green-100 text-green-800',
  Sapphire: 'bg-blue-100 text-blue-800',
  Amethyst: 'bg-purple-100 text-purple-800',
  Platinum: 'bg-slate-100 text-slate-700',
  Gold: 'bg-yellow-100 text-yellow-800',
  Silver: 'bg-gray-100 text-gray-700',
  Bronze: 'bg-orange-100 text-orange-800',
  Copper: 'bg-amber-100 text-amber-800',
};

interface LigaCategory {
  category: string;
  status: 'ok' | 'grace' | 'over';
  upperBoundary: number | null;
  graceLimit: number | null;
  assignedRating: number;
  lastCheckedRating: number;
}

interface Participant {
  name: string;
  club: string;
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
  weightVerificationStatus?: 'none' | 'pending' | 'submitted' | 'approved' | 'rejected';
  ligaCategory?: LigaCategory;
}

export default function ParticipantsPage() {
  const { user, loading: authLoading, isRegistered } = useAuth();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!user || !isRegistered) return;

    const fetchParticipants = async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch(`${API_URL}/participants?limit=2000`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.ok) {
          const data = await res.json();
          setParticipants(data.participants || []);
        } else {
          setError('Kunne ikke hente deltagere');
        }
      } catch (e) {
        setError('Netværksfejl');
      } finally {
        setLoading(false);
      }
    };

    fetchParticipants();
  }, [user, isRegistered]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return participants;
    return participants.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.club && p.club.toLowerCase().includes(q)) ||
      p.eLicense.toLowerCase().includes(q)
    );
  }, [participants, search]);

  if (authLoading || loading) return <div className="p-8 text-center text-muted-foreground">Indlæser deltagere...</div>;

  if (error) return <div className="p-8 text-center text-red-600">{error}</div>;

  return (
    <div className="max-w-7xl mx-auto mt-8 px-4">
      <h1 className="text-3xl font-bold mb-2 text-foreground">Deltagere</h1>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <p className="text-muted-foreground">Alle tilmeldte ryttere i ligaen ({participants.length}).</p>
        <input
          type="search"
          placeholder="Søg navn, klub eller licens..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="sm:w-72 px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="bg-card rounded-lg shadow overflow-hidden border border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-muted-foreground">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground border-b border-border">
              <tr>
                <th className="px-6 py-3 font-bold">Navn</th>
                <th className="px-6 py-3 font-bold">Klub</th>
                <th className="px-6 py-3 font-bold">ZR Kat</th>
                <th className="px-6 py-3 font-bold">ZR max30</th>
                <th className="px-6 py-3 font-bold">Liga Kat</th>
                <th className="px-6 py-3 font-bold">FTP (ZP)</th>
                <th className="px-6 py-3 font-bold">ZRS</th>
                <th className="px-6 py-3 font-bold">vELO</th>
                <th className="px-6 py-3 font-bold">vELO max30</th>
                <th className="px-6 py-3 font-bold">vELO max90</th>
                <th className="px-6 py-3 font-bold">Fænotype</th>
                <th className="px-6 py-3 font-bold">Strava (10 ture)</th>
                <th className="px-6 py-3 font-bold">Profillinks</th>
                <th className="px-6 py-3 font-bold text-right">E-Licens</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-6 py-8 text-center text-muted-foreground">
                    {search ? 'Ingen deltagere matcher søgningen.' : 'Ingen deltagere fundet endnu.'}
                  </td>
                </tr>
              ) : (
                filtered.map((p) => (
                  <tr key={p.eLicense} className="hover:bg-muted/50 transition">
                    <td className="px-6 py-4 font-medium text-card-foreground">
                      <div className="flex items-center gap-2">
                        {p.name}
                        {p.weightVerificationStatus === 'pending' && (
                          <span title="Vægtbekræftelse: Afventer handling" className="cursor-help text-lg">⚠️</span>
                        )}
                        {p.weightVerificationStatus === 'submitted' && (
                          <span title="Vægtbekræftelse: Til gennemsyn" className="cursor-help text-lg">⚠️</span>
                        )}
                        {p.weightVerificationStatus === 'approved' && (
                          <span title="Vægtbekræftelse: Godkendt" className="cursor-help text-lg">✅</span>
                        )}
                        {p.weightVerificationStatus === 'rejected' && (
                          <span title="Vægtbekræftelse: Afvist" className="cursor-help text-lg">❌</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-card-foreground">{p.club || '-'}</td>
                    <td className="px-6 py-4">
                      {(() => { const cat = getZRCategory(p.rating); return cat !== '-' ? (
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${ZR_CATEGORY_STYLES[cat] ?? 'bg-slate-100 text-slate-800'}`}>
                          {cat}
                        </span>
                      ) : '-'; })()}
                    </td>
                    <td className="px-6 py-4">
                      {(() => { const cat = getZRCategory(p.max30Rating); return cat !== '-' ? (
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${ZR_CATEGORY_STYLES[cat] ?? 'bg-slate-100 text-slate-800'}`}>
                          {cat}
                        </span>
                      ) : '-'; })()}
                    </td>
                    <td className="px-6 py-4">
                      {p.ligaCategory ? (
                        <div className="flex items-center gap-1.5">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${ZR_CATEGORY_STYLES[p.ligaCategory.category] ?? 'bg-slate-100 text-slate-800'}`}>
                            {p.ligaCategory.category}
                          </span>
                          {p.ligaCategory.status === 'grace' && (
                            <span title={`In grace zone (limit: ${p.ligaCategory.graceLimit})`} className="text-yellow-500 cursor-help text-xs font-bold">!</span>
                          )}
                          {p.ligaCategory.status === 'over' && (
                            <span title={`Over grace limit (${p.ligaCategory.graceLimit})`} className="text-red-500 cursor-help text-xs font-bold">!!</span>
                          )}
                        </div>
                      ) : '-'}
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
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" /></svg>
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
                            className="text-primary hover:text-primary/80 transition-colors"
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
