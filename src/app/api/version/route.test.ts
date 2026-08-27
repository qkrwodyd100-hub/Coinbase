import { afterEach, describe, expect, it, vi } from 'vitest';

describe('GET /api/version', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('declares the non-secret production commit and signals data contract', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '0123456789abcdef0123456789abcdef01234567');
    const { GET } = await import('@/app/api/version/route');

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    await expect(response.json()).resolves.toEqual({
      service: 'crypto-signal-dashboard',
      canonicalUrl: 'https://coinbase-ivory.vercel.app',
      commit: '0123456789abcdef0123456789abcdef01234567',
      dataContract: 'signals-v1',
    });
  });
});
