import { describe, expect, it } from 'vitest';
import vercelConfig from './vercel.json';

describe('Vercel alert schedule', () => {
  it('runs the authenticated durable alert worker every ten minutes', () => {
    expect(vercelConfig.crons).toContainEqual({ path: '/api/cron/alerts', schedule: '*/10 * * * *' });
  });
});
