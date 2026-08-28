/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createStore: vi.fn(() => ({ initialize: vi.fn() })),
  createProvider: vi.fn((config: unknown) => ({ config, send: vi.fn() })),
  runWorker: vi.fn(async () => ({ quietHours: false, created: 1, duplicate: 0, late: 0, claimed: 1, delivered: 1, failed: 0 })),
  getDashboardPayload: vi.fn(),
}));

vi.mock('@/lib/postgres-alert-outbox', () => ({ createPostgresAlertOutboxStore: mocks.createStore }));
vi.mock('@/lib/slack-alert-provider', () => ({
  SlackWebApiProvider: class {
    constructor(config: unknown) {
      mocks.createProvider(config);
    }

    send = vi.fn();
  },
}));
vi.mock('@/lib/alert-worker', () => ({ runAlertWorker: mocks.runWorker }));
vi.mock('@/lib/market-data', () => ({ getDashboardPayload: mocks.getDashboardPayload }));

import { GET } from '@/app/api/cron/alerts/route';

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('alert cron route', () => {
  it('rejects unauthorized requests before creating providers', async () => {
    vi.stubEnv('CRON_SECRET', 'expected-secret');
    const response = await GET(new Request('https://example.test/api/cron/alerts', { headers: { Authorization: 'Bearer wrong-secret' } }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
    expect(mocks.createStore).not.toHaveBeenCalled();
    expect(mocks.createProvider).not.toHaveBeenCalled();
    expect(mocks.runWorker).not.toHaveBeenCalled();
  });

  it('runs the durable worker with server-only configuration and returns non-sensitive counts', async () => {
    vi.stubEnv('CRON_SECRET', 'expected-secret');
    vi.stubEnv('DATABASE_URL', 'postgresql://database.example/alerts');
    vi.stubEnv('SLACK_BOT_TOKEN', 'server-only-token');
    vi.stubEnv('SLACK_CHANNEL_ID', 'C123');

    const response = await GET(new Request('https://example.test/api/cron/alerts', { headers: { Authorization: 'Bearer expected-secret' } }));
    const body = await response.json();
    const secondResponse = await GET(new Request('https://example.test/api/cron/alerts', { headers: { Authorization: 'Bearer expected-secret' } }));

    expect(response.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(body).toEqual({ ok: true, quietHours: false, created: 1, duplicate: 0, late: 0, claimed: 1, delivered: 1, failed: 0 });
    expect(JSON.stringify(body)).not.toContain('server-only-token');
    expect(mocks.createStore).toHaveBeenCalledTimes(1);
    expect(mocks.createStore).toHaveBeenCalledWith('postgresql://database.example/alerts');
    expect(mocks.createProvider).toHaveBeenCalledWith({ token: 'server-only-token', channelId: 'C123' });
    expect(mocks.runWorker).toHaveBeenCalledTimes(2);
  });
});
