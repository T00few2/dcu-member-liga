'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import LeagueManager from '@/components/admin/LeagueManager';
import VerificationDashboard from '@/components/admin/VerificationDashboard';
import TrainerManager from '@/components/admin/TrainerManager';

export default function AdminPage() {
  const { user, loading: authLoading, isAdmin, refreshClaims } = useAuth();
  const router = useRouter();
  
  // Top Level Tab State
  const [activeSection, setActiveSection] = useState<'league' | 'verification' | 'trainers'>('league');

  // Access Control
  useEffect(() => {
    if (!authLoading && !user) {
        router.push('/');
    }
  }, [user, authLoading, router]);

  if (authLoading) return <div className="p-8 text-center">Loading...</div>;
  if (!user) return null;

  if (!isAdmin) {
    return (
      <div className="max-w-3xl mx-auto mt-8 px-4">
        <h1 className="text-3xl font-bold mb-2 text-foreground">Admin Dashboard</h1>
        <p className="text-muted-foreground mb-6">
          You’re signed in, but you don’t have admin access.
        </p>
        <div className="bg-card p-6 rounded-lg shadow border border-border">
          <p className="text-card-foreground mb-4">
            If you were just granted access, refresh your session to load the new permissions.
          </p>
          <button
            onClick={() => refreshClaims()}
            className="bg-primary text-primary-foreground px-4 py-2 rounded hover:opacity-90 font-medium"
          >
            Refresh permissions
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto mt-8 px-4">
      <h1 className="text-3xl font-bold mb-2 text-foreground">Admin Dashboard</h1>
      <p className="text-muted-foreground mb-8">Manage races, settings, and rider verification.</p>
      
      {/* Top Level Navigation */}
      <div className="flex border-b border-border mb-8">
          <button 
            onClick={() => setActiveSection('league')}
            className={`pb-4 px-6 text-lg font-medium transition ${activeSection === 'league' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
          >
              League Management
          </button>
          <button 
            onClick={() => setActiveSection('verification')}
            className={`pb-4 px-6 text-lg font-medium transition ${activeSection === 'verification' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
          >
              Verification
          </button>
          <button 
            onClick={() => setActiveSection('trainers')}
            className={`pb-4 px-6 text-lg font-medium transition ${activeSection === 'trainers' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
          >
              Trainers
          </button>
      </div>

      {/* Section Content */}
      <div className="min-h-[500px]">
          {activeSection === 'league' ? (
              <LeagueManager />
          ) : activeSection === 'verification' ? (
              <VerificationDashboard />
          ) : (
              <TrainerManager />
          )}
      </div>
    </div>
  );
}
