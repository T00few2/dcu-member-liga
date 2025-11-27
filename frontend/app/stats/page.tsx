'use client';

import { useEffect, useState } from 'react';

export default function StatsPage() {
  const [stats, setStats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [manualLicense, setManualLicense] = useState('');

  const fetchStats = async (license: string) => {
    setLoading(true);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
      const res = await fetch(`${apiUrl}/stats?eLicense=${license}`);
      if (res.ok) {
        const data = await res.json();
        setStats(data.stats);
      } else {
        // Fallback/Error
        setStats([
            { platform: 'Error', message: 'Could not fetch stats' }
        ]);
      }
    } catch (e) {
         setStats([
            { platform: 'Error', message: 'Network error' }
        ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const storedLicense = localStorage.getItem('dcu_elicense');
    if (storedLicense) {
        fetchStats(storedLicense);
    } else {
        setLoading(false);
    }
  }, []);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualLicense) {
        localStorage.setItem('dcu_elicense', manualLicense);
        fetchStats(manualLicense);
    }
  };

  if (loading) return <div className="p-8 text-center">Loading stats...</div>;

  if (stats.length === 0) {
      return (
        <div className="max-w-md mx-auto mt-10 p-6 bg-white rounded shadow">
            <h1 className="text-xl font-bold mb-4">Enter E-License</h1>
            <p className="mb-4 text-slate-600">We couldn't find your saved license. Please enter it to view stats.</p>
            <form onSubmit={handleManualSubmit} className="flex gap-2">
                <input 
                    type="text" 
                    value={manualLicense}
                    onChange={(e) => setManualLicense(e.target.value)}
                    placeholder="e.g. 12345678"
                    className="flex-1 p-2 border rounded"
                />
                <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded">View</button>
            </form>
        </div>
      );
  }

  return (
    <div className="max-w-4xl mx-auto mt-8">
      <h1 className="text-3xl font-bold mb-8 text-slate-800">Rider Statistics</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {stats.map((stat, idx) => (
          <div key={idx} className="bg-white p-6 rounded-lg shadow-md border border-slate-200">
            <h2 className="text-xl font-semibold text-blue-600 mb-4">{stat.platform}</h2>
            <ul className="space-y-2">
              {Object.entries(stat).map(([key, value]) => {
                if (key === 'platform' || key === 'activities') return null;
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

      {/* Activities Section */}
      {stats.find(s => s.platform === 'Strava' && s.activities?.length > 0) && (
        <div className="bg-white rounded-lg shadow-md border border-slate-200 overflow-hidden">
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-200">
                <h2 className="text-xl font-bold text-slate-800">Recent Strava Rides</h2>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-600">
                    <thead className="bg-slate-50 text-xs uppercase font-medium text-slate-500">
                        <tr>
                            <th className="px-6 py-3">Date</th>
                            <th className="px-6 py-3">Activity Name</th>
                            <th className="px-6 py-3">Distance</th>
                            <th className="px-6 py-3">Time</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {stats.find(s => s.platform === 'Strava').activities.map((ride: any, i: number) => (
                            <tr key={i} className="hover:bg-slate-50">
                                <td className="px-6 py-4 whitespace-nowrap">{ride.date}</td>
                                <td className="px-6 py-4 font-medium text-slate-900">{ride.name}</td>
                                <td className="px-6 py-4">{ride.distance}</td>
                                <td className="px-6 py-4">{ride.moving_time}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
      )}
    </div>
  );
}
