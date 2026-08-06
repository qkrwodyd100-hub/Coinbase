import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDashboardPayload } from '@/lib/market-data';

type Overrides = {
  fearGreed?: string;
  btcPrice?: string;
  btcClose?: string;
  btcFunding?: string;
  btcOpenInterest?: string;
  btcPreviousOpenInterest?: string;
  ethBtcClose?: string;
  usdKrwRate?: number | string | null;
  failFx?: boolean;
  malformedFx?: boolean;
  usdKrwBase?: string;
  usdKrwAmount?: number;
};

function klineRows(close: string, count = 80) {
  const base = Number(close);
  const step = base >= 1 ? 1 : 0.0001;
  if (base <= 0) {
    return Array.from({ length: count }, (_, index) => [1_700_000_000_000 + index * 86_400_000, '1', '2', '0.5', close, String(1000 + index)]);
  }
  return Array.from({ length: count }, (_, index) => [
    1_700_000_000_000 + index * 86_400_000,
    String(base + index * step - step),
    String(base + index * step + step * 2),
    String(base + index * step - step * 2),
    String(base + index * step),
    String(1000 + index),
    1_700_000_000_000 + index * 86_400_000 + 86_399_999,
  ]);
}

function installMarketFetch(overrides: Overrides = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      let payload: unknown;

      if (url.includes('frankfurter.app')) {
        if (overrides.failFx) return { ok: false, json: async () => ({}) };
        payload = overrides.malformedFx
          ? { rates: null }
          : { amount: overrides.usdKrwAmount ?? 1, base: overrides.usdKrwBase ?? 'USD', rates: { KRW: overrides.usdKrwRate ?? 1370 } };
      } else if (url.includes('alternative.me')) {
        payload = { data: [{ value: overrides.fearGreed ?? '40', timestamp: '1785888000' }] };
      } else if (url.includes('/api/v3/ticker/price')) {
        payload = { symbol: url.includes('BTCUSDT') ? 'BTCUSDT' : 'ETHUSDT', price: url.includes('BTCUSDT') ? (overrides.btcPrice ?? '65000') : '3200' };
      } else if (url.includes('/api/v3/klines')) {
        if (url.includes('ETHBTC')) {
          payload = klineRows(overrides.ethBtcClose ?? '0.06');
        } else {
          payload = klineRows(url.includes('BTCUSDT') ? (overrides.btcClose ?? '60000') : '3000');
        }
      } else if (url.includes('/fapi/v1/fundingRate')) {
        payload = [{ fundingRate: url.includes('BTCUSDT') ? (overrides.btcFunding ?? '0.0001') : '0.0001', fundingTime: 1_700_000_000_000 }];
      } else if (url.includes('/futures/data/openInterestHist')) {
        payload = [
          { sumOpenInterest: overrides.btcPreviousOpenInterest ?? '1000', timestamp: 1_700_000_000_000 },
          { sumOpenInterest: url.includes('BTCUSDT') ? (overrides.btcOpenInterest ?? '1020') : '1020', timestamp: 1_700_014_400_000 },
        ];
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
    [{ btcFunding: '101' }, /funding must be between -100 and 100/i],
    [{ btcOpenInterest: '-1' }, /open interest must be greater than zero/i],
  ] satisfies Array<[Overrides, RegExp]>)('rejects invalid upstream numeric domains: %#', async (overrides, message) => {
    installMarketFetch(overrides);

    await expect(getDashboardPayload()).rejects.toThrow(message);
  });

  it('builds both asset signals from Binance and Alternative.me no-key public payloads', async () => {
    installMarketFetch();

    const payload = await getDashboardPayload();

    expect(payload.usdKrwRate).toBe(1370);
    expect(payload.fxUnavailable).toBe(false);
    expect(payload.assets.map((asset) => asset.symbol)).toEqual(['BTC', 'ETH']);
    expect(payload.assets.every((asset) => asset.overallScore >= 0 && asset.overallScore <= 100)).toBe(true);
    expect(payload.assets[0].missingFeatures).toEqual([]);
    const urls = vi.mocked(fetch).mock.calls.map(([input]) => String(input));
    expect(urls).toEqual(expect.arrayContaining([expect.stringContaining('data-api.binance.vision/api/v3/klines'), expect.stringContaining('fapi.binance.com/fapi/v1/fundingRate')]));
    expect(urls).not.toContainEqual(expect.stringContaining('api.kraken.com'));
    expect(urls).not.toContainEqual(expect.stringContaining('futures.kraken.com'));
  });

  it('keeps USD market data when the FX source temporarily fails', async () => {
    installMarketFetch({ failFx: true });

    const payload = await getDashboardPayload();

    expect(payload.usdKrwRate).toBeNull();
    expect(payload.fxUnavailable).toBe(true);
    expect(payload.assets.map((asset) => asset.price)).toEqual([65000, 3200]);
  });

  it.each([
    { usdKrwRate: -1 },
    { usdKrwRate: 'not-a-number' },
    { malformedFx: true },
    { usdKrwBase: 'EUR' },
    { usdKrwAmount: 100 },
  ] satisfies Overrides[])('keeps USD market data when the FX payload is invalid: %#', async (overrides) => {
    installMarketFetch(overrides);

    const payload = await getDashboardPayload();

    expect(payload.usdKrwRate).toBeNull();
    expect(payload.fxUnavailable).toBe(true);
    expect(payload.assets.map((asset) => asset.price)).toEqual([65000, 3200]);
  });
});
