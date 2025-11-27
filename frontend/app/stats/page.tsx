'use client';

import { useEffect, useState } from 'react';

export default function StatsPage() {
  const [stats, setStats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Mock fetch or real fetch
    const fetchStats = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
        const res = await fetch(`${apiUrl}/stats`);
        if (res.ok) {
          const data = await res.json();
          setStats(data.stats);
        } else {
          // Fallback mock data if backend isn't running
          setStats([
            { platform: 'Zwift', ftp: 280, level: 42 },
            { platform: 'ZwiftPower', category: 'A' },
            { platform: 'Strava', kmsThisYear: 6500 }
          ]);
        }
      } catch (e) {
         // Fallback mock data
         setStats([
            { platform: 'Zwift', ftp: 280, level: 42 },
            { platform: 'ZwiftPower', category: 'A' },
            { platform: 'Strava', kmsThisYear: 6500 }
          ]);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  if (loading) return <div className="p-8 text-center">Loading stats...</div>;

  return (
    <div className="max-w-4xl mx-auto mt-8">
      <h1 className="text-3xl font-bold mb-8 text-slate-800">Rider Statistics</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {stats.map((stat, idx) => (
          <div key={idx} className="bg-white p-6 rounded-lg shadow-md border border-slate-200">
            <h2 className="text-xl font-semibold text-blue-600 mb-4">{stat.platform}</h2>
            <ul className="space-y-2">
              {Object.entries(stat).map(([key, value]) => {
                if (key === 'platform') return null;
                return (
                  <li key={key} className="flex justify-between border-b border-slate-100 pb-1 last:border-0">
                    <span className="capitalize text-slate-600">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                    <span className="font-mono font-medium text-slate-900">{String(value)}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

