import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDashboardPayload } from '@/lib/market-data';

type Overrides = {
  fearGreed?: string;
  btcPrice?: string;
  btcClose?: string;
  btcFunding?: number;
  usdKrwRate?: number | string | null;
  failFx?: boolean;
};

function installMarketFetch(overrides: Overrides = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      let payload: unknown;

      if (url.includes('frankfurter.app')) {
        if (overrides.failFx) return { ok: false, json: async () => ({}) };
        payload = { rates: { KRW: overrides.usdKrwRate ?? 1370 } };
      } else if (url.includes('alternative.me')) {
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
      } else if (url.includes('futures.kraken.com') && url.includes('/tickers/')) {
        const isBtc = url.includes('PF_XBTUSD');
        payload = {
          result: 'success',
          ticker: { fundingRate: isBtc ? (overrides.btcFunding ?? 0.01) : 0.01 },
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
    [{ btcFunding: 101 }, /funding must be between -100 and 100/i],
    [{ usdKrwRate: -1 }, /USD to KRW exchange rate must be greater than zero/i],
    [{ usdKrwRate: 'not-a-number' }, /USD to KRW exchange rate is not a finite number/i],
  ] satisfies Array<[Overrides, RegExp]>)('rejects invalid upstream numeric domains: %#', async (overrides, message) => {
    installMarketFetch(overrides);

    await expect(getDashboardPayload()).rejects.toThrow(message);
  });

  it('builds both asset signals from Vercel-safe no-key public payloads', async () => {
    installMarketFetch();

    const payload = await getDashboardPayload();

    expect(payload.usdKrwRate).toBe(1370);
    expect(payload.fxUnavailable).toBe(false);
    expect(payload.assets.map((asset) => asset.symbol)).toEqual(['BTC', 'ETH']);
    expect(payload.assets.every((asset) => asset.overallScore >= 0 && asset.overallScore <= 100)).toBe(true);
    const urls = vi.mocked(fetch).mock.calls.map(([input]) => String(input));
    expect(urls).not.toContainEqual(expect.stringContaining('binance.com'));
    expect(urls).not.toContainEqual(expect.stringContaining('bybit.com'));
  });

  it('keeps USD market data when the FX source temporarily fails', async () => {
    installMarketFetch({ failFx: true });

    const payload = await getDashboardPayload();

    expect(payload.usdKrwRate).toBeNull();
    expect(payload.fxUnavailable).toBe(true);
    expect(payload.assets.map((asset) => asset.price)).toEqual([65000, 3200]);
  });
});