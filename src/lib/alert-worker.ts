import type { DurableAlertEvent } from '@/lib/alert-outbox';
import type { DashboardPayload } from '@/lib/signals';

const DEFAULT_BATCH_SIZE = 20;

export type ClaimedAlertEvent = DurableAlertEvent & {
  attemptCount: number;
};

export type AlertDeliveryAcknowledgement = {
  channelId: string;
  messageTimestamp: string;
};

export interface AlertOutboxStore {
  initialize(): Promise<void>;
  ingestSnapshot(snapshot: DashboardPayload, now: number): Promise<{ created: number; duplicate: number; late: number }>;
  claimDue(now: number, limit: number): Promise<ClaimedAlertEvent[]>;
  markSent(event: ClaimedAlertEvent, acknowledgement: AlertDeliveryAcknowledgement, now: number): Promise<void>;
  markFailed(event: ClaimedAlertEvent, errorCode: string, now: number): Promise<void>;
}

export interface AlertDeliveryProvider {
  send(event: ClaimedAlertEvent): Promise<AlertDeliveryAcknowledgement>;
}

export async function runAlertWorker({
  now,
  store,
  provider,
  getSnapshot,
  batchSize = DEFAULT_BATCH_SIZE,
}: {
  now: number;
  store: AlertOutboxStore;
  provider: AlertDeliveryProvider;
  getSnapshot: (now: number) => Promise<DashboardPayload>;
  batchSize?: number;
}): Promise<{ quietHours: boolean; created: number; duplicate: number; late: number; claimed: number; delivered: number; failed: number }> {
  await store.initialize();
  const snapshot = await getSnapshot(now);
  const ingested = await store.ingestSnapshot(snapshot, now);
  const quietHours = isSeoulQuietHours(now);
  if (quietHours) {
    return { quietHours, ...ingested, claimed: 0, delivered: 0, failed: 0 };
  }

  const events = await store.claimDue(now, batchSize);
  let delivered = 0;
  let failed = 0;
  for (const event of events) {
    try {
      const acknowledgement = await provider.send(event);
      await store.markSent(event, acknowledgement, now);
      delivered += 1;
    } catch (error) {
      await store.markFailed(event, deliveryErrorCode(error), now);
      failed += 1;
    }
  }

  return { quietHours, ...ingested, claimed: events.length, delivered, failed };
}

export function isSeoulQuietHours(now: number): boolean {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(now)),
  );
  return hour >= 23 || hour < 6;
}

function deliveryErrorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z0-9_:-]{1,80}$/.test(error.message)) return error.message;
  return 'DELIVERY_FAILED';
}
