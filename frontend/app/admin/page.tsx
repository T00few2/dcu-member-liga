'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import LeagueManager from '@/components/admin/LeagueManager';
import VerificationDashboard from '@/components/admin/VerificationDashboard';
import TrainerManager from '@/components/admin/TrainerManager';
import PolicyManager from '@/components/admin/PolicyManager';
import WeightVerificationManager from '@/components/admin/WeightVerificationManager';
import CategoryManager from '@/components/admin/CategoryManager';
import CategoryPredictor from '@/components/admin/CategoryPredictor';
import StatsDashboard from '@/components/admin/StatsDashboard';
import UsersOverview from '@/components/admin/UsersOverview';

export default function AdminPage() {
  const { user, loading: authLoading, isAdmin, refreshClaims } = useAuth();

  // Top Level Tab State
  const [activeSection, setActiveSection] = useState<'league' | 'categories' | 'predictor' | 'verification' | 'weight' | 'trainers' | 'users' | 'stats' | 'policies'>('league');

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
      <div className="flex border-b border-border mb-8 overflow-x-auto">
        <button
          onClick={() => setActiveSection('league')}
          className={`pb-4 px-6 text-lg font-medium transition whitespace-nowrap ${activeSection === 'league' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
        >
          League Management
        </button>
        <button
          onClick={() => setActiveSection('categories')}
          className={`pb-4 px-6 text-lg font-medium transition whitespace-nowrap ${activeSection === 'categories' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Categories
        </button>
        <button
          onClick={() => setActiveSection('predictor')}
          className={`pb-4 px-6 text-lg font-medium transition whitespace-nowrap ${activeSection === 'predictor' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
        >
          vELO Predictor
        </button>
        <button
          onClick={() => setActiveSection('verification')}
          className={`pb-4 px-6 text-lg font-medium transition whitespace-nowrap ${activeSection === 'verification' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Performance Analysis
        </button>
        <button
          onClick={() => setActiveSection('weight')}
          className={`pb-4 px-6 text-lg font-medium transition whitespace-nowrap ${activeSection === 'weight' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Weight Verification
        </button>
        <button
          onClick={() => setActiveSection('trainers')}
          className={`pb-4 px-6 text-lg font-medium transition whitespace-nowrap ${activeSection === 'trainers' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Trainers
        </button>
        <button
          onClick={() => setActiveSection('users')}
          className={`pb-4 px-6 text-lg font-medium transition whitespace-nowrap ${activeSection === 'users' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Users
        </button>
        <button
          onClick={() => setActiveSection('stats')}
          className={`pb-4 px-6 text-lg font-medium transition whitespace-nowrap ${activeSection === 'stats' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Stats
        </button>
        <button
          onClick={() => setActiveSection('policies')}
          className={`pb-4 px-6 text-lg font-medium transition whitespace-nowrap ${activeSection === 'policies' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Policies
        </button>
      </div>

      {/* Section Content */}
      <div className="min-h-[500px]">
        {activeSection === 'users' ? (
          <UsersOverview />
        ) : activeSection === 'stats' ? (
          <StatsDashboard />
        ) : activeSection === 'league' ? (
          <LeagueManager />
        ) : activeSection === 'categories' ? (
          <CategoryManager user={user} />
        ) : activeSection === 'predictor' ? (
          <CategoryPredictor user={user} />
        ) : activeSection === 'verification' ? (
          <VerificationDashboard />
        ) : activeSection === 'weight' ? (
          <WeightVerificationManager />
        ) : activeSection === 'trainers' ? (
          <TrainerManager />
        ) : (
          <PolicyManager user={user} />
        )}
      </div>
    </div>
  );
}
