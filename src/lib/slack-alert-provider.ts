import { createHash } from 'node:crypto';
import type { AlertDeliveryAcknowledgement, AlertDeliveryProvider, ClaimedAlertEvent } from '@/lib/alert-worker';

const SLACK_POST_MESSAGE_URL = 'https://slack.com/api/chat.postMessage';
const REQUEST_TIMEOUT_MS = 8_000;

export class SlackWebApiProvider implements AlertDeliveryProvider {
  constructor(private readonly config: { token: string; channelId: string }) {
    if (!config.token || !config.channelId) throw new Error('SLACK_PROVIDER_MISCONFIGURED');
  }

  async send(event: ClaimedAlertEvent): Promise<AlertDeliveryAcknowledgement> {
    const response = await fetch(SLACK_POST_MESSAGE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        channel: this.config.channelId,
        text: event.message,
        client_msg_id: deterministicUuid(event.key),
        unfurl_links: false,
        unfurl_media: false,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`SLACK_HTTP_${response.status}`);

    const payload: unknown = await response.json().catch(() => null);
    if (!isRecord(payload)) throw new Error('SLACK_INVALID_ACK');
    if (payload.ok !== true) throw new Error(slackApiErrorCode(payload.error));
    if (payload.channel !== this.config.channelId || typeof payload.ts !== 'string' || !/^\d+\.\d+$/.test(payload.ts)) {
      throw new Error('SLACK_INVALID_ACK');
    }
    return { channelId: payload.channel, messageTimestamp: payload.ts };
  }
}

export function deterministicUuid(key: string): string {
  const bytes = createHash('sha256').update(key).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function slackApiErrorCode(value: unknown): string {
  if (typeof value === 'string' && /^[a-z0-9_]{1,60}$/.test(value)) return `SLACK_API_${value.toUpperCase()}`;
  return 'SLACK_API_ERROR';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
