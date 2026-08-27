import { describe, expect, it } from 'vitest';
import nextConfig from './next.config';

describe('canonical deployment host', () => {
  it('redirects the legacy Vercel alias to the canonical host', async () => {
    expect(nextConfig.redirects).toBeTypeOf('function');

    const redirects = await nextConfig.redirects!();

    expect(redirects).toContainEqual({
      source: '/:path*',
      has: [{ type: 'host', value: 'crypto-signal-dashboard-chi.vercel.app' }],
      destination: 'https://coinbase-ivory.vercel.app/:path*',
      permanent: true,
    });
  });
});
