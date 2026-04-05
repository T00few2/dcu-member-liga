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
  zwiftId?: string;
  category: string;
  zftp: number | string;
  zmap: number | string;
  zwiftCategory: string;
  rating: number | string;
  max30Rating: number | string;
  max90Rating: number | string;
  phenotype: string;
  racingScore: number | string;
  weightVerificationStatus?: 'none' | 'pending' | 'submitted' | 'approved' | 'rejected';
  ligaCategory?: LigaCategory;
}

type SortColumn =
  | 'name'
  | 'club'
  | 'zrKat'
  | 'zrMax30'
  | 'ligaKat'
  | 'zwiftKat'
  | 'zftp'
  | 'zmap'
  | 'zrs'
  | 'velo'
  | 'veloMax30'
  | 'veloMax90'
  | 'phenotype';

type SortDirection = 'asc' | 'desc';

function getSortValue(p: Participant, col: SortColumn): string | number {
  switch (col) {
    case 'name': return p.name?.toLowerCase() ?? '';
    case 'club': return p.club?.toLowerCase() ?? '';
    case 'zrKat': return p.rating !== 'N/A' ? Number(p.rating) : -Infinity;
    case 'zrMax30': return p.max30Rating !== 'N/A' ? Number(p.max30Rating) : -Infinity;
    case 'ligaKat': return p.ligaCategory?.category?.toLowerCase() ?? '';
    case 'zwiftKat': return p.zwiftCategory?.toLowerCase() ?? '';
    case 'zftp': return p.zftp !== 'N/A' && p.zftp !== undefined ? Number(p.zftp) : -Infinity;
    case 'zmap': return p.zmap !== 'N/A' && p.zmap !== undefined ? Number(p.zmap) : -Infinity;
    case 'zrs': return p.racingScore !== 'N/A' && p.racingScore ? Number(p.racingScore) : -Infinity;
    case 'velo': return p.rating !== 'N/A' ? Number(p.rating) : -Infinity;
    case 'veloMax30': return p.max30Rating !== 'N/A' ? Number(p.max30Rating) : -Infinity;
    case 'veloMax90': return p.max90Rating !== 'N/A' ? Number(p.max90Rating) : -Infinity;
    case 'phenotype': return p.phenotype !== 'N/A' ? p.phenotype?.toLowerCase() ?? '' : '';
    default: return '';
  }
}

const LIGA_KAT_ORDER = ['Diamond','Ruby','Emerald','Sapphire','Amethyst','Platinum','Gold','Silver','Bronze','Copper'];

({ active, direction }: { active: boolean; direction: SortDirection }) {
  if (!active) {
    return (
      <svg className="inline ml-1 opacity-30" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
        <path d="M7 10l5-5 5 5zM7 14l5 5 5-5z" />
      </svg>
    );
  }
  return direction === 'asc' ? (
    <svg className="inline ml-1" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M7 14l5-5 5 5z" />
    </svg>
  ) : (
    <svg className="inline ml-1" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M7 10l5 5 5-5z" />
    </svg>
  );
}

export default function ParticipantsPage() {
  const { user, loading: authLoading, isRegistered } = useAuth();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [ligaKatFilter, setLigaKatFilter] = useState('');
  const [sortCol, setSortCol] = useState<SortColumn>('name');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');

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

  const ligaKatOptions = useMemo(() => {
    const cats = new Set<string>();
    for (const p of participants) {
      if (p.ligaCategory?.category) cats.add(p.ligaCategory.category);
    }
    return Array.from(cats).sort((a, b) => {
      const ai = LIGA_KAT_ORDER.indexOf(a);
      const bi = LIGA_KAT_ORDER.indexOf(b);
      const ai2 = ai === -1 ? 999 : ai;
      const bi2 = bi === -1 ? 999 : bi;
      return ai2 - bi2;
    });
  }, [participants]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let result = participants.filter(p => {
      const matchesSearch = !q || p.name.toLowerCase().includes(q) || (p.club && p.club.toLowerCase().includes(q));
      const matchesLigaKat = !ligaKatFilter || p.ligaCategory?.category === ligaKatFilter;
      return matchesSearch && matchesLigaKat;
    });

    result = [...result].sort((a, b) => {
      const av = getSortValue(a, sortCol);
      const bv = getSortValue(b, sortCol);
      if (av === bv) return 0;
      if (av === -Infinity) return 1;
      if (bv === -Infinity) return -1;
      const cmp = av < bv ? -1 : 1;
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [participants, search, ligaKatFilter, sortCol, sortDir]);

  function handleSort(col: SortColumn) {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  }

  function thProps(col: SortColumn) {
    return {
      onClick: () => handleSort(col),
      className: 'px-6 py-3 font-bold cursor-pointer select-none hover:bg-muted/80 transition-colors whitespace-nowrap',
    };
  }

  if (authLoading || loading) return <div className="p-8 text-center text-muted-foreground">Indlæser deltagere...</div>;

  if (error) return <div className="p-8 text-center text-red-600">{error}</div>;

  return (
    <div className="max-w-7xl mx-auto mt-8 px-4">
      <h1 className="text-3xl font-bold mb-2 text-foreground">Deltagere</h1>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <p className="text-muted-foreground">Alle tilmeldte ryttere i ligaen ({participants.length}).</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <select
            value={ligaKatFilter}
            onChange={e => setLigaKatFilter(e.target.value)}
            className="px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">-</option>
            {ligaKatOptions.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <input
            type="search"
            placeholder="Søg navn eller klub..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="sm:w-72 px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div className="bg-card rounded-lg shadow overflow-hidden border border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-muted-foreground">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground border-b border-border">
              <tr>
                <th {...thProps('name')}>
                  Navn <SortIcon active={sortCol === 'name'} direction={sortDir} />
                </th>
                <th {...thProps('club')}>
                  Klub <SortIcon active={sortCol === 'club'} direction={sortDir} />
                </th>
                <th {...thProps('zrKat')}>
                  ZR Kat <SortIcon active={sortCol === 'zrKat'} direction={sortDir} />
                </th>
                <th {...thProps('zrMax30')}>
                  ZR max30 <SortIcon active={sortCol === 'zrMax30'} direction={sortDir} />
                </th>
                <th {...thProps('ligaKat')}>
                  Liga Kat <SortIcon active={sortCol === 'ligaKat'} direction={sortDir} />
                </th>
                <th {...thProps('zwiftKat')}>
                  Zwift Kat <SortIcon active={sortCol === 'zwiftKat'} direction={sortDir} />
                </th>
                <th {...thProps('zftp')}>
                  zFTP <SortIcon active={sortCol === 'zftp'} direction={sortDir} />
                </th>
                <th {...thProps('zmap')}>
                  zMAP <SortIcon active={sortCol === 'zmap'} direction={sortDir} />
                </th>
                <th {...thProps('zrs')}>
                  ZRS <SortIcon active={sortCol === 'zrs'} direction={sortDir} />
                </th>
                <th {...thProps('velo')}>
                  vELO <SortIcon active={sortCol === 'velo'} direction={sortDir} />
                </th>
                <th {...thProps('veloMax30')}>
                  vELO max30 <SortIcon active={sortCol === 'veloMax30'} direction={sortDir} />
                </th>
                <th {...thProps('veloMax90')}>
                  vELO max90 <SortIcon active={sortCol === 'veloMax90'} direction={sortDir} />
                </th>
                <th {...thProps('phenotype')}>
                  Fænotype <SortIcon active={sortCol === 'phenotype'} direction={sortDir} />
                </th>
                <th className="px-6 py-3 font-bold">Profillinks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={14} className="px-6 py-8 text-center text-muted-foreground">
                    {search || ligaKatFilter ? 'Ingen deltagere matcher søgningen.' : 'Ingen deltagere fundet endnu.'}
                  </td>
                </tr>
              ) : (
                filtered.map((p, idx) => (
                  <tr key={`${p.zwiftId || 'no-zwift'}-${idx}`} className="hover:bg-muted/50 transition">
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
                    <td className="px-6 py-4">
                      {p.zwiftCategory && p.zwiftCategory !== 'N/A' ? (
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${ZR_CATEGORY_STYLES[p.zwiftCategory] ?? 'bg-slate-100 text-slate-800'}`}>
                          {p.zwiftCategory}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="px-6 py-4 font-mono text-card-foreground">
                      {p.zftp !== 'N/A' && p.zftp !== undefined ? `${Math.round(Number(p.zftp))}` : '-'}
                    </td>
                    <td className="px-6 py-4 font-mono text-card-foreground">
                      {p.zmap !== 'N/A' && p.zmap !== undefined ? `${Math.round(Number(p.zmap))}` : '-'}
                    </td>
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
                      {p.zwiftId ? (
                        <div className="flex items-center gap-3">
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
                          <a
                            href={`https://zwiftpower.com/profile.php?z=${p.zwiftId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-orange-500 hover:text-orange-600 transition-colors"
                            title="ZwiftPower Profile"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                            </svg>
                          </a>
                        </div>
                      ) : '-'}
                    </td>
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
