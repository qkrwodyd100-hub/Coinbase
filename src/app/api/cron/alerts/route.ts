import { timingSafeEqual } from 'node:crypto';
import { runAlertWorker } from '@/lib/alert-worker';
import { getDashboardPayload } from '@/lib/market-data';
import { createPostgresAlertOutboxStore } from '@/lib/postgres-alert-outbox';
import { SlackWebApiProvider } from '@/lib/slack-alert-provider';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

let durableStore: ReturnType<typeof createPostgresAlertOutboxStore> | undefined;
let durableStoreDatabaseUrl: string | undefined;

export async function GET(request: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return json({ error: 'service_not_configured' }, 503);
  if (!authorized(request.headers.get('authorization'), cronSecret)) return json({ error: 'unauthorized' }, 401);

  const databaseUrl = process.env.DATABASE_URL;
  const slackToken = process.env.SLACK_BOT_TOKEN;
  const slackChannelId = process.env.SLACK_CHANNEL_ID;
  if (!databaseUrl || !slackToken || !slackChannelId) return json({ error: 'service_not_configured' }, 503);

  try {
    const result = await runAlertWorker({
      now: Date.now(),
      store: getDurableStore(databaseUrl),
      provider: new SlackWebApiProvider({ token: slackToken, channelId: slackChannelId }),
      getSnapshot: getDashboardPayload,
    });
    return json({ ok: true, ...result }, 200);
  } catch {
    return json({ error: 'alert_worker_failed' }, 500);
  }
}

function getDurableStore(databaseUrl: string): ReturnType<typeof createPostgresAlertOutboxStore> {
  if (!durableStore || durableStoreDatabaseUrl !== databaseUrl) {
    durableStore = createPostgresAlertOutboxStore(databaseUrl);
    durableStoreDatabaseUrl = databaseUrl;
  }
  return durableStore;
}

function authorized(header: string | null, secret: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const provided = Buffer.from(header.slice('Bearer '.length));
  const expected = Buffer.from(secret);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
