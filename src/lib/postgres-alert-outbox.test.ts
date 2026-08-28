/** @vitest-environment node */
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { PostgresAlertOutboxStore } from '@/lib/postgres-alert-outbox';
import type { AssetSignal, DashboardPayload } from '@/lib/signals';

function snapshot(score: number, signalBarClose: string): DashboardPayload {
  const asset: AssetSignal = {
    symbol: 'BTC',
    name: '비트코인',
    price: 65_000,
    overallScore: score,
    signal: score >= 80 ? { label: '강력 매수', tone: 'positive' } : { label: '관망', tone: 'neutral' },
    stale: false,
    indicators: [],
    missingFeatures: [],
    scorePolicy: 'test',
    signalTimeframe: '1d',
    signalBarOpen: new Date(Date.parse(signalBarClose) - 86_400_000).toISOString(),
    signalBarClose,
    availableWeight: 100,
    coverageRegime: 'full',
    extremeEligible: true,
    extremeCoverageFloor: 100,
    features: [
      {
        id: 'price',
        source: 'Binance spot BTCUSDT',
        timeframe: '1d',
        observedAt: new Date(Date.parse(signalBarClose) - 86_400_000).toISOString(),
        availableAt: signalBarClose,
        maxAgeMs: 300_000,
        status: 'available',
      },
    ],
  };
  return {
    asOf: signalBarClose,
    signalTimeframe: '1d',
    signalBarClose,
    nextExecutableAt: signalBarClose,
    usdKrwRate: null,
    fxUnavailable: true,
    assets: [asset],
  };
}

describe('PostgreSQL durable alert outbox', () => {
  it('deduplicates and ignores late snapshots, retries after restart, and starts cooldown only on acknowledgement', async () => {
    const memoryDb = newDb({ noAstCoverageCheck: true });
    const adapter = memoryDb.adapters.createPg();
    const pool = new adapter.Pool() as unknown as Pool;
    const store = new PostgresAlertOutboxStore(pool);
    const firstNow = Date.parse('2026-08-05T00:01:00.000Z');

    await store.initialize();
    expect(await store.ingestSnapshot(snapshot(79, '2026-08-04T00:00:00.000Z'), firstNow)).toMatchObject({ created: 0 });
    expect(await store.ingestSnapshot(snapshot(80, '2026-08-05T00:00:00.000Z'), firstNow)).toMatchObject({ created: 1 });
    expect(await store.ingestSnapshot(snapshot(80, '2026-08-05T00:00:00.000Z'), firstNow)).toMatchObject({ duplicate: 1 });
    expect(await store.ingestSnapshot(snapshot(75, '2026-08-03T00:00:00.000Z'), firstNow)).toMatchObject({ late: 1 });

    await store.ingestSnapshot(snapshot(70, '2026-08-06T00:00:00.000Z'), firstNow + 1_000);
    expect(await store.ingestSnapshot(snapshot(82, '2026-08-07T00:00:00.000Z'), firstNow + 2_000)).toMatchObject({ created: 0 });

    const [firstAttempt] = await store.claimDue(firstNow, 10);
    expect(firstAttempt).toMatchObject({ key: 'BTC:strong-buy:2026-08-05T00:00:00.000Z', attemptCount: 1 });
    await store.markFailed(firstAttempt, 'SLACK_HTTP_503', firstNow);

    const restartedStore = new PostgresAlertOutboxStore(pool);
    await restartedStore.initialize();
    expect(await restartedStore.claimDue(firstNow + 59_999, 10)).toEqual([]);
    const [retry] = await restartedStore.claimDue(firstNow + 60_000, 10);
    expect(retry).toMatchObject({ key: firstAttempt.key, attemptCount: 2 });
    await restartedStore.markSent(retry, { channelId: 'C123', messageTimestamp: '123.456' }, firstNow + 60_000);

    await restartedStore.ingestSnapshot(snapshot(70, '2026-08-08T00:00:00.000Z'), firstNow + 61_000);
    expect(await restartedStore.ingestSnapshot(snapshot(82, '2026-08-09T00:00:00.000Z'), firstNow + 62_000)).toMatchObject({ created: 0 });
    await restartedStore.ingestSnapshot(snapshot(70, '2026-08-10T00:00:00.000Z'), firstNow + 6 * 60 * 60 * 1_000 + 60_001);
    expect(
      await restartedStore.ingestSnapshot(snapshot(82, '2026-08-11T00:00:00.000Z'), firstNow + 6 * 60 * 60 * 1_000 + 60_002),
    ).toMatchObject({ created: 1 });

    await pool.end();
  });

  it('moves an event to dead after five persisted delivery attempts', async () => {
    const memoryDb = newDb({ noAstCoverageCheck: true });
    const adapter = memoryDb.adapters.createPg();
    const pool = new adapter.Pool() as unknown as Pool;
    const store = new PostgresAlertOutboxStore(pool);
    let now = Date.parse('2026-08-05T00:01:00.000Z');

    await store.initialize();
    await store.ingestSnapshot(snapshot(79, '2026-08-04T00:00:00.000Z'), now);
    await store.ingestSnapshot(snapshot(80, '2026-08-05T00:00:00.000Z'), now);
    for (let attemptCount = 1; attemptCount <= 5; attemptCount += 1) {
      const [attempt] = await store.claimDue(now, 10);
      expect(attempt).toMatchObject({ attemptCount });
      await store.markFailed(attempt, 'SLACK_HTTP_503', now);
      now += 60_000 * 2 ** (attemptCount - 1);
    }

    expect(await store.claimDue(now + 24 * 60 * 60 * 1_000, 10)).toEqual([]);
    const persisted = await pool.query("SELECT status, attempt_count, sent_at FROM alert_outbox WHERE event_key = 'BTC:strong-buy:2026-08-05T00:00:00.000Z'");
    expect(persisted.rows[0]).toMatchObject({ status: 'dead', attempt_count: 5, sent_at: null });
    await pool.end();
  });
});
