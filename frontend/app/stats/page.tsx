'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function StatsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/');
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    const fetchStats = async () => {
      if (!user) return;
      
      setLoading(true);
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
        const idToken = await user.getIdToken();
        
        // Fetch user profile first to get eLicense
        // Note: We need a dedicated endpoint to get "my profile" based on token,
        // OR we assume we can look up by auth mapping.
        // Currently, we don't have a /me endpoint.
        // So for now, we rely on the fact that we can pass eLicense if we know it,
        // OR we update the backend /stats to accept an Authorization header and look up the user itself.
        
        // Update to send Authorization header
        const res = await fetch(`${apiUrl}/stats`, {
            headers: {
                'Authorization': `Bearer ${idToken}`
            }
        });
        
        if (res.ok) {
          const data = await res.json();
          setStats(data.stats);
        } else {
          // Fallback to stored license if auth lookup fails (or just error)
          const storedLicense = localStorage.getItem('dcu_elicense');
          if (storedLicense) {
             const fallbackRes = await fetch(`${apiUrl}/stats?eLicense=${storedLicense}`);
             if (fallbackRes.ok) {
                const data = await fallbackRes.json();
                setStats(data.stats);
                return;
             }
          }
          setError('Could not fetch stats');
        }
      } catch (e) {
         setError('Network error');
      } finally {
        setLoading(false);
      }
    };

    if (user && !authLoading) {
        fetchStats();
    }
  }, [user, authLoading]);

  if (authLoading) return <div className="p-8 text-center">Loading...</div>;

  if (!user) return null; // Will redirect

  if (loading) return <div className="p-8 text-center">Loading stats...</div>;

  if (stats.length === 0 && !loading) {
      return (
        <div className="max-w-md mx-auto mt-10 p-6 bg-white rounded shadow text-center">
            <h1 className="text-xl font-bold mb-4">No Stats Found</h1>
            <p className="mb-4 text-slate-600">
                We couldn't find any stats for your account. 
                Make sure you have registered for the league.
            </p>
            <Link href="/register" className="inline-block bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
                Go to Registration
            </Link>
        </div>
      );
  }

  return (
    <div className="max-w-4xl mx-auto mt-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-slate-800">Rider Statistics</h1>
        <div className="text-sm text-slate-500">
            Logged in as {user.displayName || user.email}
        </div>
      </div>
      
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
