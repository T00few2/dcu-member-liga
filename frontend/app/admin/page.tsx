'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import ErrorBoundary from '@/components/ErrorBoundary';
import LeagueManager, { type LeagueManagerTab } from '@/components/admin/LeagueManager';
import VerificationDashboard from '@/components/admin/VerificationDashboard';
import TrainerManager from '@/components/admin/TrainerManager';
import PolicyManager from '@/components/admin/PolicyManager';
import WeightVerificationManager from '@/components/admin/WeightVerificationManager';
import CategoryManager from '@/components/admin/CategoryManager';
import CategoryPredictor from '@/components/admin/CategoryPredictor';
import StatsDashboard from '@/components/admin/StatsDashboard';
import UsersOverview from '@/components/admin/UsersOverview';
import UserDetailsTab from '@/components/admin/UserDetailsTab';
import PostsManager from '@/components/admin/PostsManager';

type AdminSection = 'league' | 'categories' | 'predictor' | 'verification' | 'weight' | 'trainers' | 'users' | 'stats' | 'policies' | 'nyheder';
const ADMIN_SECTIONS: AdminSection[] = ['league', 'categories', 'predictor', 'verification', 'weight', 'trainers', 'users', 'stats', 'policies', 'nyheder'];
const LEAGUE_TABS: LeagueManagerTab[] = ['races', 'results', 'settings', 'testing', 'rawdata'];
type UsersTab = 'overview' | 'details';
const USERS_TABS: UsersTab[] = ['overview', 'details'];

function parseSection(value: string | null): AdminSection {
  return ADMIN_SECTIONS.includes(value as AdminSection) ? (value as AdminSection) : 'league';
}

function parseLeagueTab(value: string | null): LeagueManagerTab {
  return LEAGUE_TABS.includes(value as LeagueManagerTab) ? (value as LeagueManagerTab) : 'races';
}

function parseUsersTab(value: string | null): UsersTab {
  return USERS_TABS.includes(value as UsersTab) ? (value as UsersTab) : 'overview';
}

function AdminPageContent() {
  const { user, loading: authLoading, isAdmin, refreshClaims } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const sectionFromUrl = parseSection(searchParams.get('section'));
  const leagueTabFromUrl = parseLeagueTab(searchParams.get('tab'));
  const usersTabFromUrl = parseUsersTab(sectionFromUrl === 'users' ? searchParams.get('tab') : null);
  const selectedUserIdFromUrl = searchParams.get('userId') ?? null;

  // Top Level Tab State
  const [activeSection, setActiveSection] = useState<AdminSection>(sectionFromUrl);

  useEffect(() => {
    if (activeSection !== sectionFromUrl) {
      setActiveSection(sectionFromUrl);
    }
  }, [sectionFromUrl, activeSection]);

  const updateAdminUrl = useCallback((
    nextSection: AdminSection,
    nextLeagueTab?: LeagueManagerTab,
    nextUsersTab?: UsersTab,
    nextUserId?: string | null,
  ) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('section', nextSection);

    if (nextSection === 'league') {
      if (nextLeagueTab) {
        params.set('tab', nextLeagueTab);
      } else if (!params.get('tab')) {
        params.set('tab', 'races');
      }
      params.delete('userId');
    } else if (nextSection === 'users') {
      const tab = nextUsersTab ?? 'overview';
      params.set('tab', tab);
      if (tab === 'details' && nextUserId) {
        params.set('userId', nextUserId);
      } else {
        params.delete('userId');
      }
    } else {
      params.delete('tab');
      params.delete('userId');
    }

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [searchParams, router, pathname]);

  const handleSectionChange = useCallback((section: AdminSection) => {
    setActiveSection(section);
    updateAdminUrl(section);
  }, [updateAdminUrl]);

  const handleLeagueTabChange = useCallback((tab: LeagueManagerTab) => {
    if (activeSection !== 'league') {
      setActiveSection('league');
    }
    updateAdminUrl('league', tab);
  }, [updateAdminUrl, activeSection]);

  const handleUsersTabChange = useCallback((tab: UsersTab, userId?: string | null) => {
    updateAdminUrl('users', undefined, tab, userId);
  }, [updateAdminUrl]);

  const handleUserSelect = useCallback((userId: string) => {
    updateAdminUrl('users', undefined, 'details', userId);
  }, [updateAdminUrl]);

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
          onClick={() => handleSectionChange('league')}
          className={`pb-4 px-6 text-lg font-medium transition whitespace-nowrap ${activeSection === 'league' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
        >
          League Management
        </button>
        <button
          onClick={() => handleSectionChange('categories')}
          className={`pb-4 px-6 text-lg font-medium transition whitespace-nowrap ${activeSection === 'categories' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Categories
        </button>
        <button
          onClick={() => handleSectionChange('predictor')}
          className={`pb-4 px-6 text-lg font-medium transition whitespace-nowrap ${activeSection === 'predictor' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
        >
          vELO Predictor
        </button>
        <button
          onClick={() => handleSectionChange('verification')}
          className={`pb-4 px-6 text-lg font-medium transition whitespace-nowrap ${activeSection === 'verification' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Performance Analysis
        </button>
        <button
          onClick={() => handleSectionChange('weight')}
          className={`pb-4 px-6 text-lg font-medium transition whitespace-nowrap ${activeSection === 'weight' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Weight Verification
        </button>
        <button
          onClick={() => handleSectionChange('trainers')}
          className={`pb-4 px-6 text-lg font-medium transition whitespace-nowrap ${activeSection === 'trainers' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Trainers
        </button>
        <button
          onClick={() => handleSectionChange('users')}
          className={`pb-4 px-6 text-lg font-medium transition whitespace-nowrap ${activeSection === 'users' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Users
        </button>
        <button
          onClick={() => handleSectionChange('stats')}
          className={`pb-4 px-6 text-lg font-medium transition whitespace-nowrap ${activeSection === 'stats' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Stats
        </button>
        <button
          onClick={() => handleSectionChange('policies')}
          className={`pb-4 px-6 text-lg font-medium transition whitespace-nowrap ${activeSection === 'policies' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Policies
        </button>
        <button
          onClick={() => handleSectionChange('nyheder')}
          className={`pb-4 px-6 text-lg font-medium transition whitespace-nowrap ${activeSection === 'nyheder' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Nyheder
        </button>
      </div>

      {/* Section Content */}
      <div className="min-h-[500px]">
        <ErrorBoundary key={activeSection} label={activeSection}>
          {activeSection === 'users' ? (
            <div>
              <div className="flex border-b border-border mb-6">
                <button
                  onClick={() => handleUsersTabChange('overview')}
                  className={`pb-3 px-5 text-sm font-medium transition whitespace-nowrap ${usersTabFromUrl === 'overview' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  Overview
                </button>
                <button
                  onClick={() => handleUsersTabChange('details', selectedUserIdFromUrl)}
                  className={`pb-3 px-5 text-sm font-medium transition whitespace-nowrap ${usersTabFromUrl === 'details' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  User Details
                </button>
              </div>
              {usersTabFromUrl === 'overview' ? (
                <UsersOverview onUserSelect={handleUserSelect} />
              ) : (
                <UserDetailsTab
                  initialUserId={selectedUserIdFromUrl}
                  onUserSelect={handleUserSelect}
                />
              )}
            </div>
          ) : activeSection === 'stats' ? (
            <StatsDashboard />
          ) : activeSection === 'league' ? (
            <LeagueManager initialActiveTab={leagueTabFromUrl} onTabChange={handleLeagueTabChange} />
          ) : activeSection === 'categories' ? (
            <CategoryManager />
          ) : activeSection === 'predictor' ? (
            <CategoryPredictor user={user} />
          ) : activeSection === 'verification' ? (
            <VerificationDashboard />
          ) : activeSection === 'weight' ? (
            <WeightVerificationManager />
          ) : activeSection === 'trainers' ? (
            <TrainerManager />
          ) : activeSection === 'nyheder' ? (
            <PostsManager />
          ) : (
            <PolicyManager user={user} />
          )}
        </ErrorBoundary>
      </div>
    </div>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center">Loading...</div>}>
      <AdminPageContent />
    </Suspense>
  );
}
