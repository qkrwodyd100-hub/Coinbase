import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDashboardPayload } from '@/lib/market-data';

type Overrides = {
  fearGreed?: string;
  btcPrice?: string;
  btcClose?: string;
  btcFunding?: string;
};

function installMarketFetch(overrides: Overrides = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      let payload: unknown;

      if (url.includes('alternative.me')) {
        payload = { data: [{ value: overrides.fearGreed ?? '40' }] };
      } else if (url.includes('api.kraken.com') && url.includes('/Ticker')) {
        const isBtc = url.includes('XBTUSD');
        payload = { error: [], result: { TEST: { c: [isBtc ? (overrides.btcPrice ?? '65000') : '3200'] } } };
      } else if (url.includes('api.kraken.com') && url.includes('/OHLC')) {
        const isBtc = url.includes('XBTUSD');
        payload = {
          error: [],
          result: {
            TEST: Array.from({ length: 80 }, (_, index) => [0, 0, 0, 0, isBtc && index === 40 ? (overrides.btcClose ?? String(60000 + index)) : String(3000 + index)]),
            last: 123,
          },
        };
      } else if (url.includes('api.bybit.com') && url.includes('/tickers')) {
        const isBtc = url.includes('BTCUSDT');
        payload = {
          retCode: 0,
          result: { list: [{ fundingRate: isBtc ? (overrides.btcFunding ?? '0.0001') : '0.0001' }] },
        };
      } else {
        throw new Error(`Unexpected test URL: ${url}`);
      }

      return { ok: true, json: async () => payload };
    }),
  );
}

describe('market payload validation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    [{ btcPrice: '-1' }, /price must be greater than zero/i],
    [{ btcClose: '0' }, /close must be greater than zero/i],
    [{ fearGreed: '101' }, /fear & greed must be between 0 and 100/i],
    [{ btcFunding: '1.1' }, /funding must be between -1 and 1/i],
  ] satisfies Array<[Overrides, RegExp]>)('rejects invalid upstream numeric domains: %#', async (overrides, message) => {
    installMarketFetch(overrides);

    await expect(getDashboardPayload()).rejects.toThrow(message);
  });

  it('builds both asset signals from Vercel-safe no-key public payloads', async () => {
    installMarketFetch();

    const payload = await getDashboardPayload();

    expect(payload.assets.map((asset) => asset.symbol)).toEqual(['BTC', 'ETH']);
    expect(payload.assets.every((asset) => asset.overallScore >= 0 && asset.overallScore <= 100)).toBe(true);
    expect(vi.mocked(fetch).mock.calls.map(([input]) => String(input))).not.toContainEqual(expect.stringContaining('binance.com'));
  });
});