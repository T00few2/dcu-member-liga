import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User } from 'firebase/auth';
import CategoryPredictorResearch, {
  researchIssueMarkdown,
  type ResearchRun,
} from '@/components/admin/category-predictor/CategoryPredictorResearch';

const proposal: ResearchRun = {
  runId: 'r1',
  createdAt: '2026-12-02T04:41:00Z',
  startedBy: 'schedule',
  status: 'done',
  model: 'claude-opus-5-5',
  usage: { inputTokens: 150000, outputTokens: 20000, turns: 8 },
  evalRiders: 52,
  baseline: { n: 52, divisionAccuracy: 63.5, maeVelo: 71 },
  baselineReproduced: true,
  improvementPP: 3.8,
  outcome: 'proposal',
  findings: {
    baselineDivisionAccuracy: 63.5, bestDivisionAccuracy: 67.3, baselineMaeVelo: 71, bestMaeVelo: 66,
    improved: true, summary: 'The 1min/20min ratio helps sprinters.', method: 'Ridge on ratio features',
    proposedCode: 'FeatureDef("ratio", ...)', caveats: 'Small sample.', ridersChanged: 2,
  },
};

const user = { getIdToken: vi.fn().mockResolvedValue('t') } as unknown as User;
let runs: ResearchRun[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).endsWith('/admin/predictor/research/runs')) {
      return new Response(JSON.stringify({ runs }), { status: 200 });
    }
    return new Response(JSON.stringify({ status: 'queued' }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

function renderPanel() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CategoryPredictorResearch user={user} />
    </QueryClientProvider>,
  );
}

describe('CategoryPredictorResearch', () => {
  it('shows a proposal with its numbers, code and a copy-as-issue button', async () => {
    runs = [proposal];
    renderPanel();
    expect(await screen.findByText(/proposal: \+3.8 pp/)).toBeInTheDocument();
    expect(screen.getByText('63.5% → 67.3%')).toBeInTheDocument();
    expect(screen.getByText('FeatureDef("ratio", ...)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy as GitHub issue' })).toBeInTheDocument();
  });

  it('queues a run and starts processing it', async () => {
    runs = [];
    renderPanel();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Run research' }));
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map(([u]) => String(u));
      expect(urls.some(u => u.endsWith('/admin/predictor/research'))).toBe(true);
      expect(urls.some(u => u.endsWith('/admin/predictor/research/process'))).toBe(true);
    });
  });

  it('disables the button while a run is active', async () => {
    runs = [{ runId: 'r2', createdAt: '2026-12-02T04:41:00Z', status: 'running' }];
    renderPanel();
    expect(await screen.findByRole('button', { name: 'Research running…' })).toBeDisabled();
  });

  it('builds issue markdown with the code block', () => {
    const md = researchIssueMarkdown(proposal);
    expect(md).toContain('63.5% → 67.3%');
    expect(md).toContain('```python\nFeatureDef("ratio", ...)\n```');
  });
});
