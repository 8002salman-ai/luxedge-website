// ============================================================================
// LUXEDGE — SALMAN OS ADAPTER TESTS (frozen contract v1.0)
//
// The adapter must NEVER call Salman OS or fabricate success until the server
// env gates open (SALMAN_OS_BASE_URL + SALMAN_OS_TOKEN) AND the live
// handshake verifies the project + contract_version. These tests prove:
//   - WAITING without server env, no network call, no token leakage
//   - CONNECTED after a matching live handshake (project registered, version 1)
//   - CONTRACT MISMATCH / 404 → OFFLINE, and dispatch is refused
//   - run/pause/resume hit the frozen endpoints with the frozen request bodies
//   - "paused — free model unavailable" is surfaced, never a fabricated failure
// (All HTTP is mocked — no live calls.)
// ============================================================================
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  salmanOsStatus, getProjectStatus, getIntelligence, getJobs, runJob, pauseJob, resumeJob,
} from '../contract.js';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

function setEnv(partial: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(partial)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

const STATUS_OK = {
  success: true,
  data: {
    slug: 'luxedge',
    name: 'Luxedge',
    status: 'active',
    contract_version: 1,
    environment: { default_environment: 'preview', scheduler_enabled: true },
    hermes: { agent_registered: true, provider: 'deepseek', model: 'deepseek-chat', status: 'online' },
    router: { policy: { mode: 'free_critical_backup' }, models: [{ id: 'deepseek', tier: 'free', model: 'deepseek-chat' }] },
    modules: [{ id: 'product_research', label: 'Product Research', paused: true }],
    jobs: { queue: [], queue_pending: 0, queue_running: 0, latest_completed: null, latest_failed: null },
  },
  meta: { dataType: 'live' },
};

const OVERVIEW_OK = {
  success: true,
  data: {
    contract_version: 1,
    slug: 'luxedge',
    hermes: { online: true, agent: { provider: 'deepseek', model: 'deepseek-chat', status: 'online' }, node_model: 'deepseek-chat' },
    router: {
      policy: { mode: 'free_critical_backup' },
      primary_mode: 'FREE-FIRST',
      free_available: true,
      current_free_model: 'deepseek-chat',
      last_model_used: 'deepseek-chat',
      last_cost_class: 'FREE',
      fallback_used: false,
      fallback_reason: null,
      models: [],
    },
    modules: [],
    jobs: { queue_pending: 0, queue_running: 0, last_research_at: '2026-08-19T10:00:00.000Z', next_scheduled_at: null, latest_error: null },
    scheduler_enabled: true,
  },
  meta: { dataType: 'live' },
};

/** Stub global fetch with a URL-keyed router. Returns the spy. */
function stubFetch(routes: Record<string, (url: string, init?: RequestInit) => Response>) {
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    for (const [key, fn] of Object.entries(routes)) {
      if (url.includes(key)) return fn(url, init);
    }
    return json({ success: false, error: 'unexpected URL' }, 500);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function readyEnv() {
  setEnv({ SALMAN_OS_BASE_URL: 'https://salman-os.example', SALMAN_OS_TOKEN: 'super-secret-token-xyz' });
}

describe('salmanOsStatus (env-gated)', () => {
  it('reports WAITING with a safe reason when server env is missing — no credentials in payload', () => {
    setEnv({ SALMAN_OS_BASE_URL: undefined, SALMAN_OS_TOKEN: undefined });
    const s = salmanOsStatus();
    expect(s.state).toBe('WAITING');
    expect(s.reason).toContain('SALMAN OS BASE URL REQUIRED');
    expect(s.project.project).toBe('luxedge');
    expect(s.project.freeFirst).toBe(true);
    expect(s.contractVersion).toBe(1);
    expect(s.live).toBeNull();
    expect(JSON.stringify(s)).not.toContain('SALMAN_OS_TOKEN');
    expect(JSON.stringify(s)).not.toContain('sk_test');
  });

  it('reports WAITING when only the base URL is set (no token)', () => {
    setEnv({ SALMAN_OS_BASE_URL: 'https://salman-os.example', SALMAN_OS_TOKEN: undefined });
    const s = salmanOsStatus();
    expect(s.state).toBe('WAITING');
    expect(s.reason).toContain('SALMAN_OS_TOKEN');
  });

  it('makes NO network call when env is missing', async () => {
    setEnv({ SALMAN_OS_BASE_URL: undefined, SALMAN_OS_TOKEN: undefined });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const [status, items, jobs, run, pause, resume] = await Promise.all([
      getProjectStatus(), getIntelligence(), getJobs(), runJob('SEO'), pauseJob('seo_research'), resumeJob('seo_research'),
    ]);
    expect(status.state).toBe('WAITING');
    expect(items).toEqual([]);
    expect(jobs).toEqual([]);
    expect(run.ok).toBe(false);
    expect(run.error).toContain('BASE URL REQUIRED');
    expect(pause.ok).toBe(false);
    expect(resume.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('live handshake', () => {
  it('becomes CONNECTED when project is registered and contract_version matches', async () => {
    readyEnv();
    stubFetch({
      '/api/projects/luxedge/status': () => json(STATUS_OK),
      '/api/ops/overview': () => json(OVERVIEW_OK),
    });
    const s = await getProjectStatus();
    expect(s.state).toBe('CONNECTED');
    expect(s.reason).toContain('CONNECTED');
    expect(s.live).not.toBeNull();
    expect(s.live?.bridge).toBe('online');
    expect(s.live?.scheduler).toBe('ENABLED');
    expect(s.live?.freeModel).toBe('deepseek-chat');
    expect(s.live?.costClass).toBe('FREE');
    expect(s.live?.fallbackUsed).toBe(false);
    expect(s.live?.pausedModules).toEqual(['product_research']);
    expect(s.live?.lastSync).toBe('2026-08-19T10:00:00.000Z');
  });

  it('reports CONTRACT MISMATCH → OFFLINE when the backend version differs', async () => {
    readyEnv();
    stubFetch({
      '/api/projects/luxedge/status': () => json({ success: true, data: { ...STATUS_OK.data, contract_version: 2 } }),
      '/api/ops/overview': () => json({ ...OVERVIEW_OK, data: { ...OVERVIEW_OK.data, contract_version: 2 } }),
    });
    const s = await getProjectStatus();
    expect(s.state).toBe('OFFLINE');
    expect(s.reason).toContain('CONTRACT MISMATCH');
  });

  it('reports OFFLINE with a clear reason when the project is not registered (404)', async () => {
    readyEnv();
    stubFetch({
      '/api/projects/luxedge/status': () => json({ success: false, error: 'Project "luxedge" is not registered.' }, 404),
    });
    const s = await getProjectStatus();
    expect(s.state).toBe('OFFLINE');
    expect(s.reason).toContain('not registered');
  });

  it('refuses to dispatch when the handshake is not CONNECTED (mismatch) — no run call', async () => {
    readyEnv();
    const fetchMock = stubFetch({
      '/api/projects/luxedge/status': () => json({ success: true, data: { ...STATUS_OK.data, contract_version: 9 } }),
    });
    const r = await runJob('PRODUCT_RESEARCH');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('CONTRACT MISMATCH');
    const runCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/jobs/run'));
    expect(runCalls).toHaveLength(0);
  });
});

describe('dispatch (frozen endpoints + request bodies)', () => {
  function dispatchRoutes(runBody: (init?: RequestInit) => Response) {
    return stubFetch({
      '/api/projects/luxedge/status': () => json(STATUS_OK),
      '/api/ops/overview': () => json(OVERVIEW_OK),
      '/api/projects/luxedge/jobs/run': (_url, init) => runBody(init),
    });
  }

  it('runJob dispatches the frozen module id + environment body and parses the result', async () => {
    readyEnv();
    const fetchMock = dispatchRoutes(() => json({
      success: true,
      data: {
        action: 'run',
        environment: 'preview',
        results: [{ module: 'product_research', action: 'dispatched', task_id: 'task-1', duplicate: false, model: 'deepseek-chat', cost_class: 'FREE', fallback_used: false, reason: 'Free model available — TIER 0 FREE selected (free-first policy).' }],
        dispatched: 1,
        paused: 0,
      },
      meta: { policy: 'free_critical_backup', free_available: true },
    }));
    const r = await runJob('PRODUCT_RESEARCH');
    expect(r.ok).toBe(true);
    expect(r.job?.kind).toBe('PRODUCT_RESEARCH');
    expect(r.job?.status).toBe('QUEUED');
    expect(r.job?.model).toBe('deepseek-chat');
    expect(r.job?.costClass).toBe('FREE');
    const runCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/jobs/run'));
    expect(runCall).toBeTruthy();
    const init = runCall?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ module: 'product_research', environment: 'preview' });
  });

  it('surfaces "paused — free model unavailable" as policy, not a failure', async () => {
    readyEnv();
    dispatchRoutes(() => json({
      success: true,
      data: {
        action: 'run',
        environment: 'preview',
        results: [{ module: 'seo_research', action: 'paused', reason: 'Free model unavailable — non-critical job paused. No paid credits spent.' }],
        dispatched: 0,
        paused: 1,
      },
      meta: { policy: 'free_critical_backup', free_available: false },
    }));
    const r = await runJob('SEO');
    expect(r.ok).toBe(false);
    expect(r.paused).toBe(true);
    expect(r.reason).toContain('Free model unavailable');
    expect(r.error).toContain('FREE MODEL UNAVAILABLE');
  });

  it('pause/resume post { action, module } to the run endpoint and reject unknown modules', async () => {
    readyEnv();
    const fetchMock = dispatchRoutes((init) => {
      const body = JSON.parse(String(init?.body)) as { action: string; module: string };
      expect(['pause', 'resume']).toContain(body.action);
      expect(body.module).toBe('seo_research');
      return json({ success: true, data: { module: body.module, paused: body.action === 'pause' }, meta: {} });
    });
    const p = await pauseJob('seo_research');
    const r = await resumeJob('seo_research');
    expect(p.ok).toBe(true);
    expect(r.ok).toBe(true);
    const bad = await pauseJob('not-a-module');
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('Unknown Salman OS module');
    const runCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/jobs/run'));
    expect(runCalls).toHaveLength(2);
  });
});

describe('read feeds (intelligence + jobs)', () => {
  it('parses backend intelligence items into typed items', async () => {
    readyEnv();
    stubFetch({
      '/api/projects/luxedge/intelligence': () => json({
        success: true,
        data: {
          project: 'luxedge',
          generated_at: '2026-08-19T11:00:00.000Z',
          items: [{
            id: 'intel-1',
            task_type: 'product_discovery',
            title: 'Product gap scan',
            summary: 'Two thin catalog categories found.',
            findings: [{ title: 'F', evidence: ['ev1'], source_urls: ['https://example.com/pdp'] }],
            model: 'deepseek-chat',
            provider: 'deepseek',
            cost_class: 'FREE',
            fallback_used: false,
            completed_at: '2026-08-19T10:30:00.000Z',
            created_at: '2026-08-19T10:00:00.000Z',
          }],
          total: 1,
        },
        meta: { dataType: 'live' },
      }),
    });
    const items = await getIntelligence('PRODUCT');
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('PRODUCT');
    expect(items[0].model).toBe('deepseek-chat');
    expect(items[0].costClass).toBe('FREE');
    expect(items[0].evidence).toEqual(['ev1']);
    expect(items[0].sources).toEqual(['https://example.com/pdp']);
    expect(items[0].generatedAt).toBe('2026-08-19T10:30:00.000Z');
  });

  it('parses the jobs payload (queue/completed/failed) and overlays paused modules', async () => {
    readyEnv();
    stubFetch({
      '/api/projects/luxedge/jobs': () => json({
        success: true,
        data: {
          queue: [{ id: 'q1', title: 'SEO run', status: 'running', task_type: 'seo_research', created_at: '2026-08-19T09:00:00.000Z' }],
          queue_pending: 0,
          queue_running: 1,
          latest_completed: {
            id: 'c1', title: 'Product scan', task_type: 'product_discovery', completed_at: '2026-08-19T08:00:00.000Z',
            result: JSON.stringify({ model: 'deepseek-chat', cost_class: 'FREE', fallback_used: false }),
          },
          latest_failed: { id: 'f1', title: 'Ads', task_type: 'ads_research', created_at: '2026-08-19T07:00:00.000Z', error: 'quota' },
        },
        meta: { dataType: 'live' },
      }),
      '/api/projects/luxedge/status': () => json(STATUS_OK),
    });
    const jobs = await getJobs();
    expect(jobs.some((j) => j.id === 'q1' && j.kind === 'SEO' && j.status === 'RUNNING')).toBe(true);
    expect(jobs.some((j) => j.id === 'c1' && j.status === 'COMPLETED' && j.model === 'deepseek-chat')).toBe(true);
    expect(jobs.some((j) => j.id === 'f1' && j.status === 'FAILED' && j.error === 'quota')).toBe(true);
    // product_research module is paused in STATUS_OK → PAUSED job present
    expect(jobs.some((j) => j.kind === 'PRODUCT_RESEARCH' && j.status === 'PAUSED')).toBe(true);
  });
});

describe('secret hygiene', () => {
  it('never returns the token or base URL in any result payload', async () => {
    readyEnv();
    stubFetch({
      '/api/projects/luxedge/status': () => json(STATUS_OK),
      '/api/ops/overview': () => json(OVERVIEW_OK),
      '/api/projects/luxedge/intelligence': () => json({ success: true, data: { items: [], total: 0 }, meta: {} }),
      '/api/projects/luxedge/jobs': () => json({ success: true, data: { queue: [], queue_pending: 0, queue_running: 0, latest_completed: null, latest_failed: null }, meta: {} }),
    });
    const results = [salmanOsStatus(), await getProjectStatus(), { items: await getIntelligence() }, { jobs: await getJobs() }];
    const blob = JSON.stringify(results);
    expect(blob).not.toContain('super-secret-token-xyz');
    expect(blob).not.toContain('salman-os.example');
  });
});
