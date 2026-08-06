import { describe, expect, it } from 'vitest';
import { closedCandleBoundary, runBacktest, summarizeBacktest, valueForUtcDate } from '@/lib/backtest';

const hour = 60 * 60 * 1000;
const day = 24 * hour;

function candle(index: number, close: number) {
  return {
    openTime: index * 4 * hour,
    open: close - 1,
    high: close + 1,
    low: close - 2,
    close,
    volume: 1000 + index,
  };
}

describe('backtest event aggregation', () => {
  it('uses an interval-specific closed-candle boundary', () => {
    const time = Date.UTC(2026, 7, 6, 10, 30);

    expect(closedCandleBoundary(time, '4h')).toBe(Date.UTC(2026, 7, 6, 8));
    expect(closedCandleBoundary(time, '1d')).toBe(Date.UTC(2026, 7, 6, 0));
  });

  it('does not carry a stale daily Fear & Greed value across a missing UTC date', () => {
    const rows = [
      { date: '2026-08-04', value: 20 },
      { date: '2026-08-06', value: 40 },
    ];

    expect(valueForUtcDate(rows, Date.UTC(2026, 7, 5, 12))).toBeUndefined();
    expect(valueForUtcDate(rows, Date.UTC(2026, 7, 6, 12))).toBe(40);
  });

  it('counts only new entries into an extreme signal band and uses the next observable open as entry', () => {
    const scored = [
      { candle: candle(0, 100), score: 79 },
      { candle: candle(1, 101), score: 82 },
      { candle: candle(2, 102), score: 85 },
      { candle: candle(3, 106), score: 77 },
      { candle: candle(4, 107), score: 19 },
      { candle: candle(5, 103), score: 18 },
      { candle: candle(6, 99), score: 24 },
    ];

    const result = runBacktest({ asset: 'BTC', interval: '4h', horizonMs: 8 * hour, scoredCandles: scored });

    expect(result.lookAheadRule).toContain('next candle open');
    expect(result.signals).toHaveLength(2);
    expect(result.signals[0]).toMatchObject({ type: 'strong-buy', signalOpenTime: 4 * hour, entryOpenTime: 8 * hour, success: true });
    expect(result.signals[1]).toMatchObject({ type: 'strong-sell', signalOpenTime: 16 * hour, entryOpenTime: 20 * hour, success: true });
  });

  it('summarizes per asset and signal type with counts, hit rate, average close return, and excursion metrics', () => {
    const result = runBacktest({
      asset: 'ETH',
      interval: '1d',
      horizonMs: 7 * day,
      scoredCandles: [
        { candle: { ...candle(0, 100), openTime: 0 }, score: 81 },
        { candle: { ...candle(1, 104), openTime: day }, score: 75 },
        { candle: { ...candle(2, 106), openTime: 2 * day }, score: 19 },
        { candle: { ...candle(3, 102), openTime: 3 * day }, score: 22 },
        { candle: { ...candle(4, 96), openTime: 4 * day }, score: 25 },
        { candle: { ...candle(5, 97), openTime: 5 * day }, score: 25 },
        { candle: { ...candle(6, 95), openTime: 6 * day }, score: 25 },
        { candle: { ...candle(7, 94), openTime: 7 * day }, score: 25 },
        { candle: { ...candle(8, 93), openTime: 8 * day }, score: 25 },
        { candle: { ...candle(9, 92), openTime: 9 * day }, score: 25 },
      ],
    });

    const summary = summarizeBacktest([result]);

    expect(summary.rows).toEqual([
      expect.objectContaining({
        asset: 'ETH',
        signalType: 'strong-buy',
        signalCount: 1,
        hitCount: 1,
        hitRatePercent: 100,
        averageCloseReturnPercent: -8.74,
        averageMaxFavorablePercent: 3.88,
        averageMaxAdversePercent: -10.68,
      }),
      expect.objectContaining({
        asset: 'ETH',
        signalType: 'strong-sell',
        signalCount: 1,
        hitCount: 1,
        hitRatePercent: 100,
        averageCloseReturnPercent: -8.91,
        averageMaxFavorablePercent: 10.89,
        averageMaxAdversePercent: -1.98,
      }),
    ]);
    expect(summary.dataLimitations).toContain('missing indicators are explicitly excluded and available weights are normalized; full-data and limited-data results must be compared separately.');
  });

  it('does not inspect a candle that starts exactly at the end of the forward horizon', () => {
    const scored = Array.from({ length: 8 }, (_, index) => ({
      candle: {
        openTime: index * 4 * hour,
        open: index === 1 ? 100 : 99,
        high: index === 7 ? 104 : 102,
        low: 98,
        close: 100,
        volume: 1000,
      },
      score: index === 0 ? 82 : 45,
    }));

    const result = runBacktest({ asset: 'BTC', interval: '4h', horizonMs: 24 * hour, scoredCandles: scored });

    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]).toMatchObject({ entryOpenTime: 4 * hour, entryPrice: 100, success: false, maxFavorablePercent: 2 });
  });

  it('excludes an extreme signal when the full forward horizon is not available', () => {
    const scored = Array.from({ length: 4 }, (_, index) => ({
      candle: candle(index, 100 + index),
      score: index === 0 ? 82 : 45,
    }));

    const result = runBacktest({ asset: 'BTC', interval: '4h', horizonMs: 24 * hour, scoredCandles: scored });

    expect(result.signals).toHaveLength(0);
    expect(result.excludedSignals).toBe(1);
  });
});
