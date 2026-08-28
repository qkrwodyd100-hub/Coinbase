import { Pool, type PoolClient } from 'pg';
import { evaluateAssetSnapshot, type DurableAlertState } from '@/lib/alert-outbox';
import type { AlertDeliveryAcknowledgement, AlertOutboxStore, ClaimedAlertEvent } from '@/lib/alert-worker';
import type { AssetSignal, DashboardPayload } from '@/lib/signals';

const MAX_ATTEMPTS = 5;
const CLAIM_LEASE_MS = 2 * 60 * 1_000;
const BASE_RETRY_MS = 60 * 1_000;
const MAX_RETRY_MS = 60 * 60 * 1_000;

const CREATE_STATE_TABLE = `
  CREATE TABLE IF NOT EXISTS alert_asset_state (
    asset_symbol TEXT PRIMARY KEY,
    previous_score INTEGER NOT NULL,
    signal_bar_close TIMESTAMPTZ NOT NULL,
    coverage_regime TEXT NOT NULL CHECK (coverage_regime IN ('full', 'limited', 'insufficient')),
    extreme_eligible BOOLEAN NOT NULL,
    strong_buy_last_sent_at TIMESTAMPTZ,
    strong_sell_last_sent_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL
  )
`;

const CREATE_OUTBOX_TABLE = `
  CREATE TABLE IF NOT EXISTS alert_outbox (
    asset_symbol TEXT NOT NULL,
    alert_type TEXT NOT NULL CHECK (alert_type IN ('strong-buy', 'strong-sell')),
    signal_bar_close TIMESTAMPTZ NOT NULL,
    event_key TEXT NOT NULL UNIQUE,
    previous_score INTEGER NOT NULL,
    score INTEGER NOT NULL,
    signal_timeframe TEXT NOT NULL CHECK (signal_timeframe = '1d'),
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'sent', 'dead')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL,
    lease_until TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    provider_channel_id TEXT,
    provider_message_ts TEXT,
    last_error_code TEXT,
    PRIMARY KEY (asset_symbol, alert_type, signal_bar_close)
  )
`;

export class PostgresAlertOutboxStore implements AlertOutboxStore {
  constructor(private readonly pool: Pool) {}

  async initialize(): Promise<void> {
    await this.pool.query(CREATE_STATE_TABLE);
    await this.pool.query(CREATE_OUTBOX_TABLE);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS alert_outbox_due_idx ON alert_outbox (status, next_attempt_at, lease_until)`);
  }

  async ingestSnapshot(snapshot: DashboardPayload, now: number): Promise<{ created: number; duplicate: number; late: number }> {
    validateCanonicalSnapshot(snapshot);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const counts = { created: 0, duplicate: 0, late: 0 };
      for (const asset of snapshot.assets) {
        await this.ingestAsset(client, asset, now, counts);
      }
      await client.query('COMMIT');
      return counts;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async claimDue(now: number, limit: number): Promise<ClaimedAlertEvent[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('INVALID_CLAIM_LIMIT');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE alert_outbox
         SET status = 'dead', lease_until = NULL, last_error_code = 'RETRY_EXHAUSTED'
         WHERE status = 'sending' AND lease_until <= $1 AND attempt_count >= $2`,
        [new Date(now), MAX_ATTEMPTS],
      );
      const due = await client.query<OutboxRow>(
        `SELECT * FROM alert_outbox
         WHERE attempt_count < $1
           AND ((status = 'pending' AND next_attempt_at <= $2) OR (status = 'sending' AND lease_until <= $2))
         ORDER BY created_at, asset_symbol, alert_type
         LIMIT $3
         FOR UPDATE SKIP LOCKED`,
        [MAX_ATTEMPTS, new Date(now), limit],
      );
      const claimed: ClaimedAlertEvent[] = [];
      for (const row of due.rows) {
        const attemptCount = Number(row.attempt_count) + 1;
        await client.query(
          `UPDATE alert_outbox
           SET status = 'sending', attempt_count = $4, lease_until = $5, last_error_code = NULL
           WHERE asset_symbol = $1 AND alert_type = $2 AND signal_bar_close = $3`,
          [row.asset_symbol, row.alert_type, row.signal_bar_close, attemptCount, new Date(now + CLAIM_LEASE_MS)],
        );
        claimed.push(mapOutboxRow(row, attemptCount));
      }
      await client.query('COMMIT');
      return claimed;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async markSent(event: ClaimedAlertEvent, acknowledgement: AlertDeliveryAcknowledgement, now: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        `UPDATE alert_outbox
         SET status = 'sent', sent_at = $5, lease_until = NULL,
             provider_channel_id = $6, provider_message_ts = $7, last_error_code = NULL
         WHERE asset_symbol = $1 AND alert_type = $2 AND signal_bar_close = $3
           AND status = 'sending' AND attempt_count = $4`,
        [event.assetSymbol, event.type, new Date(event.signalBarClose), event.attemptCount, new Date(now), acknowledgement.channelId, acknowledgement.messageTimestamp],
      );
      if (updated.rowCount !== 1) throw new Error('STALE_DELIVERY_ACK');
      const column = event.type === 'strong-buy' ? 'strong_buy_last_sent_at' : 'strong_sell_last_sent_at';
      const stateUpdated = await client.query(`UPDATE alert_asset_state SET ${column} = $2, updated_at = $2 WHERE asset_symbol = $1`, [event.assetSymbol, new Date(now)]);
      if (stateUpdated.rowCount !== 1) throw new Error('MISSING_ALERT_STATE');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async markFailed(event: ClaimedAlertEvent, errorCode: string, now: number): Promise<void> {
    const exhausted = event.attemptCount >= MAX_ATTEMPTS;
    const nextAttemptAt = new Date(now + retryDelayMs(event.attemptCount));
    const updated = await this.pool.query(
      `UPDATE alert_outbox
       SET status = $5, next_attempt_at = $6, lease_until = NULL, last_error_code = $7
       WHERE asset_symbol = $1 AND alert_type = $2 AND signal_bar_close = $3
         AND status = 'sending' AND attempt_count = $4`,
      [event.assetSymbol, event.type, new Date(event.signalBarClose), event.attemptCount, exhausted ? 'dead' : 'pending', nextAttemptAt, sanitizeErrorCode(errorCode)],
    );
    if (updated.rowCount !== 1) throw new Error('STALE_DELIVERY_FAILURE');
  }

  private async ingestAsset(
    client: PoolClient,
    asset: AssetSignal,
    now: number,
    counts: { created: number; duplicate: number; late: number },
  ): Promise<void> {
    let selected = await client.query<StateRow>('SELECT * FROM alert_asset_state WHERE asset_symbol = $1 FOR UPDATE', [asset.symbol]);
    if (!selected.rows[0]) {
      const inserted = await client.query(
        `INSERT INTO alert_asset_state (
           asset_symbol, previous_score, signal_bar_close, coverage_regime, extreme_eligible, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (asset_symbol) DO NOTHING`,
        [asset.symbol, asset.overallScore, new Date(asset.signalBarClose), asset.coverageRegime, asset.extremeEligible, new Date(now)],
      );
      if (inserted.rowCount === 1) return;
      selected = await client.query<StateRow>('SELECT * FROM alert_asset_state WHERE asset_symbol = $1 FOR UPDATE', [asset.symbol]);
    }
    const row = selected.rows[0];
    if (!row) throw new Error('MISSING_ALERT_STATE');
    const incomingClose = Date.parse(asset.signalBarClose);
    const storedClose = timestampMs(row.signal_bar_close);
    if (incomingClose === storedClose) {
      counts.duplicate += 1;
      return;
    }
    if (incomingClose < storedClose) {
      counts.late += 1;
      return;
    }

    const previousState: DurableAlertState = {
      previousScore: Number(row.previous_score),
      signalBarClose: new Date(storedClose).toISOString(),
      coverageRegime: row.coverage_regime,
      extremeEligible: row.extreme_eligible,
      lastSentAt: {
        ...(row.strong_buy_last_sent_at ? { 'strong-buy': timestampMs(row.strong_buy_last_sent_at) } : {}),
        ...(row.strong_sell_last_sent_at ? { 'strong-sell': timestampMs(row.strong_sell_last_sent_at) } : {}),
      },
    };
    const evaluated = evaluateAssetSnapshot({ asset, previousState, now, hasPendingForType: false });
    let event = evaluated.event;
    if (event) {
      const pending = await client.query(
        `SELECT 1 FROM alert_outbox
         WHERE asset_symbol = $1 AND alert_type = $2 AND status IN ('pending', 'sending')
         LIMIT 1`,
        [event.assetSymbol, event.type],
      );
      if (pending.rowCount) event = null;
    }

    await client.query(
      `UPDATE alert_asset_state
       SET previous_score = $2, signal_bar_close = $3, coverage_regime = $4,
           extreme_eligible = $5, updated_at = $6
       WHERE asset_symbol = $1`,
      [asset.symbol, asset.overallScore, new Date(asset.signalBarClose), asset.coverageRegime, asset.extremeEligible, new Date(now)],
    );
    if (!event) return;

    const enqueued = await client.query(
      `INSERT INTO alert_outbox (
         asset_symbol, alert_type, signal_bar_close, event_key, previous_score, score,
         signal_timeframe, message, created_at, status, next_attempt_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $9)
       ON CONFLICT DO NOTHING`,
      [event.assetSymbol, event.type, new Date(event.signalBarClose), event.key, event.previousScore, event.score, event.signalTimeframe, event.message, new Date(event.createdAt)],
    );
    if (enqueued.rowCount === 1) counts.created += 1;
    else counts.duplicate += 1;
  }
}

export function createPostgresAlertOutboxStore(connectionString: string): PostgresAlertOutboxStore {
  return new PostgresAlertOutboxStore(new Pool({ connectionString, max: 1 }));
}

function validateCanonicalSnapshot(snapshot: DashboardPayload): void {
  if (snapshot.signalTimeframe !== '1d' || !Number.isFinite(Date.parse(snapshot.signalBarClose))) {
    throw new Error('INVALID_CANONICAL_SNAPSHOT');
  }
  for (const asset of snapshot.assets) {
    if (asset.signalTimeframe !== '1d' || asset.signalBarClose !== snapshot.signalBarClose || !Number.isFinite(Date.parse(asset.signalBarClose))) {
      throw new Error('INVALID_CANONICAL_SNAPSHOT');
    }
  }
}

function retryDelayMs(attemptCount: number): number {
  return Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** Math.max(0, attemptCount - 1));
}

function sanitizeErrorCode(value: string): string {
  return /^[A-Z0-9_:-]{1,80}$/.test(value) ? value : 'DELIVERY_FAILED';
}

function timestampMs(value: Date | string): number {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error('INVALID_PERSISTED_TIMESTAMP');
  return timestamp;
}

type StateRow = {
  previous_score: number | string;
  signal_bar_close: Date | string;
  coverage_regime: DurableAlertState['coverageRegime'];
  extreme_eligible: boolean;
  strong_buy_last_sent_at: Date | string | null;
  strong_sell_last_sent_at: Date | string | null;
};

type OutboxRow = {
  asset_symbol: ClaimedAlertEvent['assetSymbol'];
  alert_type: ClaimedAlertEvent['type'];
  signal_bar_close: Date | string;
  event_key: string;
  previous_score: number | string;
  score: number | string;
  signal_timeframe: '1d';
  message: string;
  created_at: Date | string;
  attempt_count: number | string;
};

function mapOutboxRow(row: OutboxRow, attemptCount: number): ClaimedAlertEvent {
  return {
    key: row.event_key,
    assetSymbol: row.asset_symbol,
    type: row.alert_type,
    previousScore: Number(row.previous_score),
    score: Number(row.score),
    signalTimeframe: row.signal_timeframe,
    signalBarClose: new Date(timestampMs(row.signal_bar_close)).toISOString(),
    createdAt: timestampMs(row.created_at),
    message: row.message,
    attemptCount,
  };
}
