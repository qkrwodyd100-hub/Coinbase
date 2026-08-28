import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDashboardPayload } from '@/lib/market-data';
import { scoreBacktestCandles } from '@/lib/backtest-scoring';
import { deriveBtcRelativeCandles } from '@/lib/btc-relative';
import type { AssetSymbol, MarketCandle } from '@/lib/signals';

type Overrides = {
  fearGreed?: string;
  btcClose?: string;
  btcFunding?: string;
  btcOpenInterest?: string;
  btcPreviousOpenInterest?: string;
  ethBtcClose?: string;
  usdKrwRate?: number | string | null;
  failFx?: boolean;
  failFutures?: boolean;
  failOpenInterest?: boolean;
  futuresAgeMs?: number;
  malformedFuturesJson?: boolean;
  malformedFx?: boolean;
  usdKrwBase?: string;
  usdKrwAmount?: number;
  incompleteLatestClose?: string;
};

const EXPECTED_SYMBOLS = ['BTC', 'ETH', 'SHIB', 'FIL', 'STX', 'DOGE', 'ARB', 'XRP'];
const EXPECTED_PRICES = [60079, 3079, 89, 89, 89, 89, 89, 89];
const DAY_MS = 86_400_000;
const CANDLE_START = 1_700_000_000_000;
const FULL_SIGNAL_BAR_CLOSE = CANDLE_START + 80 * DAY_MS;

function klineRows(close: string, count = 80, incompleteLatestClose?: string) {
  const base = Number(close);
  const step = base >= 1 ? 1 : 0.0001;
  if (base <= 0) {
    return Array.from({ length: count }, (_, index) => [
      CANDLE_START + index * DAY_MS,
      '1',
      '2',
      '0.5',
      close,
      String(1000 + index),
      CANDLE_START + (index + 1) * DAY_MS - 1,
    ]);
  }
  return Array.from({ length: count }, (_, index) => {
    const isIncompleteLatest = index === count - 1 && incompleteLatestClose !== undefined;
    return [
      1_700_000_000_000 + index * 86_400_000,
      String(base + index * step - step),
      String(base + index * step + step * 2),
      String(base + index * step - step * 2),
      isIncompleteLatest ? incompleteLatestClose : String(base + index * step),
      String(1000 + index),
      isIncompleteLatest ? Date.UTC(2100, 0, 1) : 1_700_000_000_000 + index * 86_400_000 + 86_399_999,
    ];
  });
}

function installMarketFetch(overrides: Overrides = {}) {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    let payload: unknown;
    if (url.includes('frankfurter.app')) {
      if (overrides.failFx) return { ok: false, json: async () => ({}) };
      payload = overrides.malformedFx ? { rates: null } : { amount: overrides.usdKrwAmount ?? 1, base: overrides.usdKrwBase ?? 'USD', rates: { KRW: overrides.usdKrwRate ?? 1370 } };
    } else if (url.includes('alternative.me')) {
      payload = { data: [{ value: overrides.fearGreed ?? '40', timestamp: String(FULL_SIGNAL_BAR_CLOSE / 1000) }] };
    } else if (url.includes('/api/v3/klines')) {
      payload = klineRows(
        url.includes('BTCUSDT') ? (overrides.btcClose ?? '60000') : url.includes('ETHUSDT') ? '3000' : url.includes('ETHBTC') ? (overrides.ethBtcClose ?? '0.06') : '10',
        80,
        overrides.incompleteLatestClose,
      );
    } else if (url.includes('/fapi/v1/fundingRate')) {
      if (overrides.failFutures) return { ok: false, status: 451, json: async () => ({}) };
      if (overrides.malformedFuturesJson) return { ok: true, status: 200, json: async () => Promise.reject(new SyntaxError('invalid JSON')) };
      payload = [{ fundingRate: url.includes('BTCUSDT') ? (overrides.btcFunding ?? '0.0001') : '0.0001', fundingTime: FULL_SIGNAL_BAR_CLOSE - (overrides.futuresAgeMs ?? 8 * 60 * 60 * 1000) }];
    } else if (url.includes('/futures/data/openInterestHist')) {
      if (overrides.failFutures || overrides.failOpenInterest) return { ok: false, status: 451, json: async () => ({}) };
      const currentAgeMs = overrides.futuresAgeMs ?? 4 * 60 * 60 * 1000;
      payload = [{ sumOpenInterest: overrides.btcPreviousOpenInterest ?? '1000', timestamp: FULL_SIGNAL_BAR_CLOSE - currentAgeMs - 4 * 60 * 60 * 1000 }, { sumOpenInterest: url.includes('BTCUSDT') ? (overrides.btcOpenInterest ?? '1020') : '1020', timestamp: FULL_SIGNAL_BAR_CLOSE - currentAgeMs }];
    } else throw new Error(`Unexpected test URL: ${url}`);
    return { ok: true, json: async () => payload };
  }));
}

function replayCandles(close: string): MarketCandle[] {
  return klineRows(close).map((row) => ({
    openTime: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  }));
}

describe('market payload validation', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each([
    [{ btcClose: '0' }, /close must be greater than zero/i], [{ fearGreed: '101' }, /fear & greed must be between 0 and 100/i], [{ btcFunding: '101' }, /funding must be between -100 and 100/i], [{ btcOpenInterest: '-1' }, /open interest must be greater than zero/i],
  ] satisfies Array<[Overrides, RegExp]>)('rejects invalid upstream numeric domains: %#', async (overrides, message) => { installMarketFetch(overrides); await expect(getDashboardPayload()).rejects.toThrow(message); });
  it('builds all eight asset signals from Binance and Alternative.me no-key public payloads', async () => {
    installMarketFetch(); const payload = await getDashboardPayload();
    expect(payload.usdKrwRate).toBe(1370); expect(payload.fxUnavailable).toBe(false);
    expect(payload.assets.map((asset) => asset.symbol)).toEqual(EXPECTED_SYMBOLS);
    expect(payload.assets.map((asset) => asset.price)).toEqual(EXPECTED_PRICES);
    expect(payload.assets.every((asset) => asset.overallScore >= 0 && asset.overallScore <= 100)).toBe(true);
    expect(payload.assets.find((asset) => asset.symbol === 'SHIB')?.indicators.some((indicator) => indicator.id === 'alt-btc-strength')).toBe(true);
    const urls = vi.mocked(fetch).mock.calls.map(([input]) => String(input));
    expect(urls).toEqual(expect.arrayContaining([expect.stringContaining('SHIBUSDT'), expect.stringContaining('BTCUSDT'), expect.stringContaining('data-api.binance.vision/api/v3/klines')]));
  });
  it('uses the latest fully closed daily candle and excludes an in-progress candle from price and scoring', async () => {
    installMarketFetch({ incompleteLatestClose: '999999' });

    const payload = await getDashboardPayload();
    const btc = payload.assets.find((asset) => asset.symbol === 'BTC');

    expect(btc?.price).toBe(60078);
    expect(btc?.signalBarClose).toBe(new Date(1_700_000_000_000 + 79 * 86_400_000).toISOString());
  });
  it('exposes one daily closed-bar instant and explicit fresh source metadata for every scored feature', async () => {
    installMarketFetch();

    const payload = await getDashboardPayload(FULL_SIGNAL_BAR_CLOSE + 60 * 60 * 1000);

    expect(payload.signalTimeframe).toBe('1d');
    expect(payload.signalBarClose).toBe(new Date(FULL_SIGNAL_BAR_CLOSE).toISOString());
    expect(payload.nextExecutableAt).toBe(payload.signalBarClose);
    for (const asset of payload.assets) {
      expect(asset.signalTimeframe).toBe('1d');
      expect(asset.signalBarClose).toBe(payload.signalBarClose);
      expect(asset.signalBarOpen).toBe(new Date(FULL_SIGNAL_BAR_CLOSE - DAY_MS).toISOString());
      expect(asset.coverageRegime).toBe('full');
      expect(asset.availableWeight).toBe(100);
      expect(asset.extremeEligible).toBe(true);
      expect(asset.stale).toBe(false);
      expect(asset.features.length).toBeGreaterThanOrEqual(6);
      expect(asset.features).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'moving-averages', source: 'binance-spot-klines', timeframe: '1d', status: 'available' }),
        expect.objectContaining({ id: 'funding', source: 'binance-usdm-funding', timeframe: '8h', status: 'available' }),
        expect.objectContaining({ id: 'open-interest', source: 'binance-usdm-open-interest', timeframe: '4h', status: 'available' }),
      ]));
      expect(asset.features.every((feature) => feature.observedAt && feature.availableAt && feature.maxAgeMs > 0)).toBe(true);
    }
  });
  it('replays the same closed inputs to the same score for all eight API assets', async () => {
    installMarketFetch();
    const payload = await getDashboardPayload(FULL_SIGNAL_BAR_CLOSE + 60 * 60 * 1000);
    const btcCandles = replayCandles('60000');
    const ethBtcCandles = replayCandles('0.06');

    for (const apiAsset of payload.assets) {
      const close = apiAsset.symbol === 'BTC' ? '60000' : apiAsset.symbol === 'ETH' ? '3000' : '10';
      const candles = replayCandles(close);
      const altBtcCandles = apiAsset.symbol === 'SHIB'
        ? deriveBtcRelativeCandles(candles, btcCandles)
        : apiAsset.symbol === 'BTC' || apiAsset.symbol === 'ETH'
          ? []
          : replayCandles('10');
      const replayed = scoreBacktestCandles({
        asset: apiAsset.symbol as AssetSymbol,
        timeframe: '1d',
        candles,
        fearGreed: [{ date: new Date(FULL_SIGNAL_BAR_CLOSE).toISOString().slice(0, 10), value: 40 }],
        funding: [{ fundingTime: FULL_SIGNAL_BAR_CLOSE - 8 * 60 * 60 * 1000, fundingRatePercent: 0.01 }],
        openInterest: [
          { timestamp: FULL_SIGNAL_BAR_CLOSE - 8 * 60 * 60 * 1000, openInterest: 1000 },
          { timestamp: FULL_SIGNAL_BAR_CLOSE - 4 * 60 * 60 * 1000, openInterest: 1020 },
        ],
        ethBtcCandles,
        altBtcCandles,
      }).at(-1)!;

      expect(replayed.signal.signalBarClose).toBe(payload.signalBarClose);
      expect(replayed.signal.coverageRegime).toBe('full');
      expect(replayed.score, apiAsset.symbol).toBe(apiAsset.overallScore);
    }
  });
  it('keeps all USD market signals when the FX source temporarily fails', async () => { installMarketFetch({ failFx: true }); const payload = await getDashboardPayload(); expect(payload.usdKrwRate).toBeNull(); expect(payload.fxUnavailable).toBe(true); expect(payload.assets.map((asset) => asset.price)).toEqual(EXPECTED_PRICES); });
  it('keeps scores diagnostic but fail-closes extremes when all futures features are unavailable', async () => {
    installMarketFetch({ failFutures: true });
    const payload = await getDashboardPayload(FULL_SIGNAL_BAR_CLOSE + 60 * 60 * 1000);
    expect(payload.assets.map((asset) => asset.symbol)).toEqual(EXPECTED_SYMBOLS);
    expect(payload.assets.every((asset) => asset.missingFeatures.includes('funding') && asset.missingFeatures.includes('open-interest'))).toBe(true);
    expect(payload.assets.every((asset) => asset.coverageRegime === 'limited' && asset.availableWeight === (asset.symbol === 'ETH' ? 81 : 80) && !asset.extremeEligible)).toBe(true);
  });
  it('declares the funding-only regime at 90 points without silently granting the missing OI weight', async () => {
    installMarketFetch({ failOpenInterest: true });
    const payload = await getDashboardPayload(FULL_SIGNAL_BAR_CLOSE + 60 * 60 * 1000);
    const btc = payload.assets.find((asset) => asset.symbol === 'BTC')!;
    expect(btc.availableWeight).toBe(90);
    expect(btc.coverageRegime).toBe('limited');
    expect(btc.extremeEligible).toBe(false);
    expect(btc.missingFeatures).toEqual(['open-interest']);
  });
  it('derives stale and coverage from explicit feature max ages at the signal close', async () => {
    installMarketFetch({ futuresAgeMs: 13 * 60 * 60 * 1000 });
    const payload = await getDashboardPayload(FULL_SIGNAL_BAR_CLOSE + 60 * 60 * 1000);
    const btc = payload.assets.find((asset) => asset.symbol === 'BTC')!;
    expect(btc.features.find((feature) => feature.id === 'funding')).toMatchObject({ status: 'stale', maxAgeMs: 12 * 60 * 60 * 1000 });
    expect(btc.features.find((feature) => feature.id === 'open-interest')).toMatchObject({ status: 'stale', maxAgeMs: 8 * 60 * 60 * 1000 });
    expect(btc.stale).toBe(true);
    expect(btc.availableWeight).toBe(80);
    expect(btc.extremeEligible).toBe(false);
  });
  it('rejects malformed JSON from a successful futures response', async () => { installMarketFetch({ malformedFuturesJson: true }); await expect(getDashboardPayload()).rejects.toThrow(/invalid json/i); });
  it.each([{ usdKrwRate: -1 }, { usdKrwRate: 'not-a-number' }, { malformedFx: true }, { usdKrwBase: 'EUR' }, { usdKrwAmount: 100 }] satisfies Overrides[])('keeps all USD market data when the FX payload is invalid: %#', async (overrides) => { installMarketFetch(overrides); const payload = await getDashboardPayload(); expect(payload.usdKrwRate).toBeNull(); expect(payload.fxUnavailable).toBe(true); expect(payload.assets.map((asset) => asset.price)).toEqual(EXPECTED_PRICES); });
});
