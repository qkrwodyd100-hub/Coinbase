/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SlackWebApiProvider } from '@/lib/slack-alert-provider';
import type { ClaimedAlertEvent } from '@/lib/alert-worker';

type FetchFunction = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const event: ClaimedAlertEvent = {
  key: 'BTC:strong-buy:2026-08-05T00:00:00.000Z',
  assetSymbol: 'BTC',
  type: 'strong-buy',
  previousScore: 79,
  score: 80,
  signalTimeframe: '1d',
  signalBarClose: '2026-08-05T00:00:00.000Z',
  createdAt: Date.parse('2026-08-05T00:01:00.000Z'),
  message: 'BTC crossing\n리스크: 투자 조언이나 거래 실행이 아닙니다.',
  attemptCount: 1,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Slack Web API alert provider', () => {
  it('uses a stable client message id and returns only the acknowledged channel and timestamp', async () => {
    const fetchMock = vi.fn<FetchFunction>(async () => new Response(JSON.stringify({ ok: true, channel: 'C123', ts: '123.456' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new SlackWebApiProvider({ token: 'test-token', channelId: 'C123' });

    const first = await provider.send(event);
    const second = await provider.send({ ...event, attemptCount: 2 });

    expect(first).toEqual({ channelId: 'C123', messageTimestamp: '123.456' });
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstRequest = fetchMock.mock.calls[0];
    const secondRequest = fetchMock.mock.calls[1];
    expect(firstRequest[0]).toBe('https://slack.com/api/chat.postMessage');
    expect(firstRequest[1]?.headers).toMatchObject({ Authorization: 'Bearer test-token', 'Content-Type': 'application/json; charset=utf-8' });
    const firstBody = JSON.parse(String(firstRequest[1]?.body));
    const secondBody = JSON.parse(String(secondRequest[1]?.body));
    expect(firstBody).toMatchObject({ channel: 'C123', text: event.message });
    expect(firstBody.client_msg_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(secondBody.client_msg_id).toBe(firstBody.client_msg_id);
  });

  it('returns bounded non-sensitive error codes for HTTP and Slack API failures', async () => {
    const fetchMock = vi
      .fn<FetchFunction>()
      .mockResolvedValueOnce(new Response('upstream unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: 'channel_not_found' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new SlackWebApiProvider({ token: 'private-test-token', channelId: 'C123' });

    await expect(provider.send(event)).rejects.toThrow('SLACK_HTTP_503');
    await expect(provider.send(event)).rejects.toThrow('SLACK_API_CHANNEL_NOT_FOUND');
  });
});
