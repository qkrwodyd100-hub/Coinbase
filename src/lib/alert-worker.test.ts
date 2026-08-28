import { describe, expect, it, vi } from 'vitest';
import type { DurableAlertEvent } from '@/lib/alert-outbox';
import {
  isSeoulQuietHours,
  runAlertWorker,
  type AlertDeliveryAcknowledgement,
  type AlertOutboxStore,
  type ClaimedAlertEvent,
} from '@/lib/alert-worker';
import type { DashboardPayload } from '@/lib/signals';

const snapshot: DashboardPayload = {
  asOf: '2026-08-05T00:01:00.000Z',
  signalTimeframe: '1d',
  signalBarClose: '2026-08-05T00:00:00.000Z',
  nextExecutableAt: '2026-08-05T00:00:00.000Z',
  usdKrwRate: null,
  fxUnavailable: true,
  assets: [],
};

const queuedEvent: DurableAlertEvent = {
  key: 'BTC:strong-buy:2026-08-05T00:00:00.000Z',
  assetSymbol: 'BTC',
  type: 'strong-buy',
  previousScore: 79,
  score: 80,
  signalTimeframe: '1d',
  signalBarClose: '2026-08-05T00:00:00.000Z',
  createdAt: Date.parse('2026-08-05T00:01:00.000Z'),
  message: 'BTC crossing',
};

class TestStore implements AlertOutboxStore {
  private queued: ClaimedAlertEvent[] = [{ ...queuedEvent, attemptCount: 1 }];
  readonly ingestSnapshot = vi.fn(async () => ({ created: 0, duplicate: 0, late: 0 }));
  readonly markSent = vi.fn(async (...args: [ClaimedAlertEvent, AlertDeliveryAcknowledgement, number]) => {
    void args;
    this.queued = [];
  });
  readonly markFailed = vi.fn(async () => undefined);
  readonly claimDue = vi.fn(async () => this.queued.slice());
  readonly initialize = vi.fn(async () => undefined);
}

describe('scheduled alert worker', () => {
  it('uses exact Asia/Seoul quiet-hour boundaries', () => {
    expect(isSeoulQuietHours(Date.parse('2026-08-04T13:59:00.000Z'))).toBe(false); // 22:59 KST
    expect(isSeoulQuietHours(Date.parse('2026-08-04T14:00:00.000Z'))).toBe(true); // 23:00 KST
    expect(isSeoulQuietHours(Date.parse('2026-08-04T20:59:00.000Z'))).toBe(true); // 05:59 KST
    expect(isSeoulQuietHours(Date.parse('2026-08-04T21:00:00.000Z'))).toBe(false); // 06:00 KST
  });

  it('queues through Seoul quiet hours and delivers once when the window opens', async () => {
    const store = new TestStore();
    const send = vi.fn(async (): Promise<AlertDeliveryAcknowledgement> => ({ channelId: 'C123', messageTimestamp: '123.456' }));
    const getSnapshot = vi.fn(async () => snapshot);

    const quietResult = await runAlertWorker({
      now: Date.parse('2026-08-04T20:59:00.000Z'),
      store,
      provider: { send },
      getSnapshot,
    });
    const openResult = await runAlertWorker({
      now: Date.parse('2026-08-04T21:00:00.000Z'),
      store,
      provider: { send },
      getSnapshot,
    });
    await runAlertWorker({
      now: Date.parse('2026-08-04T21:10:00.000Z'),
      store,
      provider: { send },
      getSnapshot,
    });

    expect(quietResult).toMatchObject({ quietHours: true, delivered: 0 });
    expect(openResult).toMatchObject({ quietHours: false, delivered: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(store.markSent).toHaveBeenCalledTimes(1);
    expect(store.markFailed).not.toHaveBeenCalled();
  });

  it('persists a safe retry failure without advancing acknowledgement state', async () => {
    const store = new TestStore();
    const send = vi.fn(async () => {
      throw new Error('SLACK_HTTP_503');
    });
    const now = Date.parse('2026-08-04T21:00:00.000Z');

    const result = await runAlertWorker({ now, store, provider: { send }, getSnapshot: async () => snapshot });

    expect(result).toMatchObject({ delivered: 0, failed: 1 });
    expect(store.markSent).not.toHaveBeenCalled();
    expect(store.markFailed).toHaveBeenCalledWith(expect.objectContaining({ key: queuedEvent.key }), 'SLACK_HTTP_503', now);
  });
});
