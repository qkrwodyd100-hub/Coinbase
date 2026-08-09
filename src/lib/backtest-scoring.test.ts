import { describe, expect, it } from 'vitest';
import { scoreBacktestCandles } from '@/lib/backtest-scoring';

const fourHours = 4 * 60 * 60 * 1000;

function candles(start: number, base: number) {
  return Array.from({ length: 60 }, (_, index) => ({
    openTime: start + index * fourHours,
    open: base + index,
    high: base + index + 2,
    low: base + index - 2,
    close: base + index + 1,
    volume: index === 59 ? 2_000 : 1_000,
  }));
}

describe('historical backtest scoring', () => {
  it.each(['SHIB', 'FIL', 'STX', 'DOGE', 'ARB', 'XRP'] as const)('includes the available ALT/BTC relative-strength weight for %s', (asset) => {
    const start = Date.UTC(2026, 0, 1);
    const assetCandles = candles(start, 100);
    const btcCandles = candles(start, 0.01);

    const scored = scoreBacktestCandles({
      asset,
      candles: assetCandles,
      fearGreed: [{ date: '2026-01-10', value: 20 }],
      funding: [{ fundingTime: start, fundingRatePercent: -0.01 }],
      altBtcCandles: btcCandles,
    });

    expect(scored).not.toHaveLength(0);
    expect(scored.at(-1)?.signal.indicators.at(-1)).toMatchObject({ id: 'alt-btc-strength', maxScore: 15 });
    expect(scored.at(-1)?.signal.missingFeatures).not.toContain('alt-btc-strength');
    expect(scored.every(({ signal }) => signal.overallScore >= 0 && signal.overallScore <= 100)).toBe(true);
  });
});
