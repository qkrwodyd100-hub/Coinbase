import { describe, expect, it } from 'vitest';
import {
  buildAssetSignal,
  calculateMovingAverage,
  calculateRsi,
  formatKrw,
  formatUsdWithKrw,
  normalizeEthBtcStrengthScore,
  scoreFearGreed,
  scoreFunding,
  scoreFuturesPositioning,
  scoreMfi,
  scoreMovingAverages,
  scoreRsi,
  signalForScore,
} from '@/lib/signals';

describe('signal scoring thresholds', () => {
  it.each([
    [30, 20],
    [30.01, 15],
    [50, 15],
    [50.01, 5],
    [69.99, 5],
    [70, 0],
  ])('scores RSI %s as %s', (value, expected) => {
    expect(scoreRsi(value).score).toBe(expected);
  });

  it.each([
    [25, 15],
    [25.01, 12],
    [45, 12],
    [45.01, 8],
    [60, 8],
    [60.01, 4],
    [75, 4],
    [75.01, 0],
  ])('scores Fear & Greed %s as %s', (value, expected) => {
    expect(scoreFearGreed(value).score).toBe(expected);
  });

  it.each([
    [0, 10],
    [-0.001, 10],
    [0.0001, 8],
    [0.01, 8],
    [0.0101, 4],
    [0.03, 4],
    [0.0301, 0],
  ])('scores funding %s%% as %s', (value, expected) => {
    expect(scoreFunding(value).score).toBe(expected);
  });

  it.each([
    [{ price: 104, ma20: 100, ma50: 90 }, 25],
    [{ price: 112, ma20: 100, ma50: 90 }, 20],
    [{ price: 118, ma20: 100, ma50: 90 }, 12],
    [{ price: 96, ma20: 100, ma50: 90 }, 10],
    [{ price: 88, ma20: 100, ma50: 90 }, 5],
    [{ price: 100, ma20: 101, ma50: 100 }, 10],
  ])('scores moving averages %# deterministically', (input, expected) => {
    expect(scoreMovingAverages(input.price, input.ma20, input.ma50).score).toBe(expected);
  });

  it.each([
    [20, 20],
    [30, 16],
    [50, 12],
    [70, 5],
    [80, 0],
  ])('scores MFI %s as %s', (value, expected) => {
    expect(scoreMfi(value).score).toBe(expected);
  });

  it.each([
    [{ fundingPercent: -0.001, oiChangePercent: 2, priceChangePercent: 2 }, 20],
    [{ fundingPercent: 0.008, oiChangePercent: -2, priceChangePercent: 2 }, 14],
    [{ fundingPercent: 0.02, oiChangePercent: 3, priceChangePercent: -2 }, 4],
    [{ fundingPercent: 0.04, oiChangePercent: 3, priceChangePercent: 2 }, 2],
  ])('scores funding plus OI positioning %#', (input, expected) => {
    expect(scoreFuturesPositioning(input).score).toBe(expected);
  });

  it.each([
    [{ current: 0.07, ma20: 0.068 }, 100],
    [{ current: 0.07, ma20: 0.07 }, 50],
    [{ current: 0.068, ma20: 0.07 }, 0],
  ])('normalizes ETH/BTC relative strength %#', (input, expected) => {
    expect(normalizeEthBtcStrengthScore(input.current, input.ma20)).toBe(expected);
  });

  it.each([
    [80, '강력 매수'],
    [79, '매수'],
    [60, '매수'],
    [59, '관망'],
    [41, '관망'],
    [40, '매도'],
    [21, '매도'],
    [20, '강력 매도'],
  ])('labels overall score %s as %s', (score, label) => {
    expect(signalForScore(score).label).toBe(label);
  });
});

describe('currency formatting', () => {
  it('formats KRW without misleading decimals', () => {
    expect(formatKrw(89_000_000)).toBe('₩89,000,000');
  });

  it('places computed KRW immediately beside the USD price', () => {
    expect(formatUsdWithKrw(64_622, 1377.2399492432917)).toBe('$64,622 · ₩89,000,000');
  });

  it('falls back to USD only when the exchange rate is unavailable', () => {
    expect(formatUsdWithKrw(64_622, null)).toBe('$64,622');
  });
});

describe('indicator calculations', () => {
  it('calculates simple moving averages over the requested period', () => {
    expect(calculateMovingAverage([1, 2, 3, 4, 5], 3)).toBe(4);
  });

  it('calculates RSI(14) from historical closes', () => {
    const closes = [44, 44.15, 43.9, 44.35, 44.9, 45.1, 45, 45.45, 45.9, 46.1, 45.8, 46.2, 46.7, 46.95, 47.15];

    expect(calculateRsi(closes, 14)).toBeCloseTo(85.39, 2);
  });

  it('uses Wilder smoothing across history after the initial RSI window', () => {
    const sharedTail = [100, 101, 99, 102, 98, 103, 97, 104, 96, 105, 95, 106, 94, 107, 93];
    const risingHistory = [80, 84, 88, 92, 96, ...sharedTail];
    const fallingHistory = [120, 116, 112, 108, 104, ...sharedTail];

    expect(calculateRsi(risingHistory, 14)).not.toBe(calculateRsi(fallingHistory, 14));
  });
});

describe('advanced asset signal contract', () => {
  it('combines BTC indicators into a 0-100 score without missing features', () => {
    const candles = Array.from({ length: 60 }, (_, index) => ({
      openTime: index * 86_400_000,
      open: 100 + index,
      high: 102 + index,
      low: 99 + index,
      close: 101 + index,
      volume: 1000 + index * 10,
    }));

    const signal = buildAssetSignal({
      symbol: 'BTC',
      name: '비트코인',
      price: 160,
      candles,
      fearGreed: 20,
      fundingPercent: -0.001,
      oiChangePercent: 2,
      priceChangePercent: 2,
    });

    expect(signal.overallScore).toBeGreaterThanOrEqual(0);
    expect(signal.overallScore).toBeLessThanOrEqual(100);
    expect(signal.missingFeatures).toEqual([]);
    expect(signal.indicators.map((indicator) => indicator.id)).toEqual(['moving-averages', 'rsi', 'mfi', 'futures-positioning', 'fear-greed']);
  });

  it('keeps ETH in 0-100 by blending base score 95% with ETH/BTC strength 5%', () => {
    const closes = Array.from({ length: 60 }, (_, index) => 100 + index);

    const signal = buildAssetSignal({
      symbol: 'ETH',
      name: '이더리움',
      price: 160,
      closes,
      fearGreed: 20,
      fundingPercent: -0.001,
      ethBtcCurrent: 0.07,
      ethBtcMa20: 0.068,
    });

    expect(signal.overallScore).toBeGreaterThanOrEqual(0);
    expect(signal.overallScore).toBeLessThanOrEqual(100);
    expect(signal.indicators.at(-1)?.id).toBe('eth-btc-strength');
  });

  it('normalizes available indicator weights instead of silently awarding zero for missing OI or MFI', () => {
    const closes = Array.from({ length: 60 }, (_, index) => 100 + index);

    const signal = buildAssetSignal({
      symbol: 'BTC',
      name: '비트코인',
      price: 160,
      closes,
      fearGreed: 50,
      fundingPercent: 0.02,
    });

    expect(signal.missingFeatures).toEqual(['mfi', 'open-interest']);
    expect(signal.scorePolicy).toContain('available indicator weights');
    expect(signal.overallScore).toBeGreaterThanOrEqual(0);
    expect(signal.overallScore).toBeLessThanOrEqual(100);
  });
});
