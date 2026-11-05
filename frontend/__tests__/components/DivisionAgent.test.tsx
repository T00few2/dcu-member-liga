import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User } from 'firebase/auth';
import DivisionAgent, { type DivisionProposal } from '@/components/admin/DivisionAgent';
import type { UnansweredQuestion } from '@/components/admin/UnansweredQuestions';

const proposal: DivisionProposal = {
  id: 'p1',
  zwiftId: '42',
  name: 'Test Rider',
  status: 'pending',
  reasons: ['few_rides'],
  currentCategory: null,
  proposedCategory: 'Gold',
  predictedVelo: 1080,
  source: 'strava',
  confidence: 'high',
  flags: ['few_strava_rides'],
  adminRationale: 'Strava 20-min power points to Gold.',
  riderExplanation: 'Vi foreslår Gold. En admin beslutter.',
  evidence: {
    divisions: ['Diamond', 'Gold', 'Silver'],
    zwiftActivityCount: 3,
    strava: {
      activityCount: 12, indoorCount: 4, outdoorCount: 8, days: 90,
      prediction: { velo: 1080, category: 'Gold', confidence: 'high' },
    },
  },
};

const lockedProposal: DivisionProposal = {
  ...proposal,
  id: 'p2',
  name: 'Locked Rider',
  currentCategory: 'Silver',
  locked: true,
  movePreview: { message: 'Moves 2 races to Gold', races: [] },
};

const user = { getIdToken: vi.fn().mockResolvedValue('t') } as unknown as User;
let fetchMock: ReturnType<typeof vi.fn>;
let pending: DivisionProposal[] = [];
let openQuestions: UnansweredQuestion[] = [];

beforeEach(() => {
  pending = [proposal];
  openQuestions = [{ id: 'u1', question: 'Må jeg køre på MTB?', missing: 'bike rules', threadId: '77',
    guildId: '11', status: 'open', createdAt: '2026-11-05T12:00:00Z' }];
  fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.endsWith('/admin/division-agent/status')) {
      return new Response(JSON.stringify({ enabled: true, queued: 3, waiting: 1, pending: pending.length }), { status: 200 });
    }
    if (u.includes('/admin/division-agent/proposals?status=pending')) {
      return new Response(JSON.stringify({ proposals: pending }), { status: 200 });
    }
    if (u.includes('/admin/division-agent/proposals?status=history')) {
      return new Response(JSON.stringify({ proposals: [] }), { status: 200 });
    }
    if (u.includes('/admin/division-agent/filter-preview')) {
      const f = JSON.parse(decodeURIComponent(u.split('filter=')[1].split('&')[0]));
      const matching = f.onlyUnlocked ? 12 : 40;
      return new Response(JSON.stringify({ total: 600, inGroup: f.onlyUnlocked ? 300 : 600, matching,
        byReason: { no_velo: 5, no_max30: matching, few_rides: 30, no_division: 0 }, pendingOutside: f.onlyUnlocked ? 3 : 0 }),
        { status: 200 });
    }
    if (u.includes('/admin/division-agent/unanswered?status=open')) {
      return new Response(JSON.stringify({ items: openQuestions }), { status: 200 });
    }
    if (u.includes('/admin/division-agent/unanswered?status=resolved')) {
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }
    if (u.includes('/admin/division-agent/unanswered/') && u.endsWith('/resolve')) {
      openQuestions = [];
      return new Response(JSON.stringify({ item: {} }), { status: 200 });
    }
    if (u.endsWith('/admin/division-agent/scan')) {
      return new Response(JSON.stringify({ queued: 4 }), { status: 200 });
    }
    return new Response(JSON.stringify({ proposal: {} }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderAgent() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DivisionAgent user={user} />
    </QueryClientProvider>,
  );
}

function decisionBody() {
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/admin/division-agent/proposals/p1/decision'));
  return call ? JSON.parse((call[1] as RequestInit).body as string) : null;
}

describe('DivisionAgent', () => {
  it('shows a pending proposal with its evidence, flags and status', async () => {
    renderAgent();
    expect(await screen.findByText('Test Rider')).toBeInTheDocument();
    expect(screen.getByText('few Strava rides')).toBeInTheDocument();
    expect(screen.getByText('Strava 20-min power points to Gold.')).toBeInTheDocument();
    expect(screen.getByText(/4 indoor, 8 outdoor/)).toBeInTheDocument();
    expect(await screen.findByText(/1 pending · 3 queued \(1 waiting for Strava\)/)).toBeInTheDocument();
  });

  it('approves a proposal', async () => {
    const u = userEvent.setup();
    renderAgent();
    await u.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(decisionBody()).toEqual({ action: 'approve' }));
  });

  it('edits the division with a note', async () => {
    const u = userEvent.setup();
    renderAgent();
    await u.click(await screen.findByRole('button', { name: 'Edit' }));
    await u.selectOptions(screen.getByLabelText('Division'), 'Silver');
    await u.type(screen.getByLabelText('Note'), 'Injured');
    await u.click(screen.getByRole('button', { name: 'Apply division' }));
    await waitFor(() => expect(decisionBody()).toEqual({ action: 'edit', category: 'Silver', note: 'Injured' }));
  });

  it('rejects with a note', async () => {
    const u = userEvent.setup();
    renderAgent();
    await u.click(await screen.findByRole('button', { name: 'Reject' }));
    await u.type(screen.getByLabelText('Note'), 'Known case');
    await u.click(screen.getByRole('button', { name: 'Reject proposal' }));
    await waitFor(() => expect(decisionBody()).toEqual({ action: 'reject', note: 'Known case' }));
  });

  it('shows the transfer preview for a locked rider', async () => {
    pending = [lockedProposal];
    renderAgent();
    expect(await screen.findByText('Mid-season transfer preview')).toBeInTheDocument();
    expect(screen.getByText('Moves 2 races to Gold')).toBeInTheDocument();
  });

  it('scans riders on demand', async () => {
    const u = userEvent.setup();
    renderAgent();
    await u.click(await screen.findByRole('button', { name: 'Scan riders now' }));
    expect(await screen.findByText(/4 rider\(s\) queued/)).toBeInTheDocument();
  });

  it('shows that a scan is running and when nobody needs a review', async () => {
    const gate: { release?: (r: Response) => void } = {};
    const base = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/admin/division-agent/scan')) {
        return new Promise<Response>((resolve) => { gate.release = resolve; });
      }
      return base(url, init);
    });
    const u = userEvent.setup();
    renderAgent();
    await u.click(await screen.findByRole('button', { name: 'Scan riders now' }));
    const busy = await screen.findByRole('button', { name: 'Scanning…' });
    expect(busy).toBeDisabled();
    expect(screen.getByText('Scanning riders…')).toBeInTheDocument();
    gate.release?.(new Response(JSON.stringify({ queued: 0 }), { status: 200 }));
    expect(await screen.findByText('No riders match the filter right now.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scan riders now' })).toBeEnabled();
  });

  it('marks the agent as working while riders are queued', async () => {
    renderAgent();
    expect(await screen.findByText(/3 queued.*working…/)).toBeInTheDocument();
  });
});

describe('DivisionAgent and Discord', () => {
  it('shows an appeal with the rider statement', async () => {
    pending = [{
      ...proposal, id: 'p3', origin: 'appeal', requestedCategory: 'Bronze', suggestedCategory: 'Gold',
      riderStatement: 'My power meter reads high outdoors', flags: ['appeal_not_supported'],
    }];
    renderAgent();
    expect(await screen.findByText('appeal')).toBeInTheDocument();
    expect(screen.getByText(/Rider asks for Bronze/)).toBeInTheDocument();
    expect(screen.getByText(/My power meter reads high outdoors/)).toBeInTheDocument();
    expect(screen.getByText('the numbers do not support the request')).toBeInTheDocument();
  });

  it('switches auto-reply on', async () => {
    const u = userEvent.setup();
    renderAgent();
    await u.click(await screen.findByLabelText('Answer division questions on Discord without approval'));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/admin/division-agent/settings'));
      expect(call && JSON.parse((call[1] as RequestInit).body as string)).toEqual({ autoReply: true });
    });
  });

  it('lists unanswered questions with a link to the thread and marks them solved', async () => {
    const u = userEvent.setup();
    renderAgent();
    await u.click(await screen.findByRole('button', { name: 'Unanswered questions' }));
    expect(await screen.findByText('“Må jeg køre på MTB?”')).toBeInTheDocument();
    expect(screen.getByText('Missing: bike rules')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the thread in Discord' }))
      .toHaveAttribute('href', 'https://discord.com/channels/11/77');
    await u.type(screen.getByPlaceholderText('What did you fix? (optional)'), 'Added to /info');
    await u.click(screen.getByRole('button', { name: 'Mark as solved' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/unanswered/u1/resolve'));
      expect(call && JSON.parse((call[1] as RequestInit).body as string)).toEqual({ note: 'Added to /info' });
    });
    expect(await screen.findByText('No unanswered questions.')).toBeInTheDocument();
  });

  it('chooses which riders to check, with a live count, and saves the filter', async () => {
    const u = userEvent.setup();
    renderAgent();
    expect(await screen.findByText(/of 600 riders match/)).toBeInTheDocument();
    await u.click(screen.getByLabelText('are not locked (have not raced yet)'));
    expect(await screen.findByText(/3 pending card\(s\) will be closed/)).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/admin/division-agent/settings')
        && JSON.parse(String((init as RequestInit).body)).reviewFilter);
      expect(call && JSON.parse((call[1] as RequestInit).body as string)).toEqual({
        reviewFilter: { newSignupsDays: null, onlyUnlocked: true, onlyWithStrava: false, skipAdminPlaced: false,
          reasons: ['no_velo', 'no_max30', 'few_rides'] },
        minZwiftRides: 15,
      });
    });
    expect(screen.getByRole('heading', { name: 'Agent' })).toBeInTheDocument();
  });
});
