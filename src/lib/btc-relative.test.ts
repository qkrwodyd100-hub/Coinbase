import { describe, expect, it } from 'vitest';
import { deriveBtcRelativeCandles } from '@/lib/btc-relative';

const assetCandles = [
  { openTime: 1_000, open: 20, high: 24, low: 18, close: 22, volume: 100 },
  { openTime: 3_000, open: 40, high: 44, low: 36, close: 42, volume: 200 },
];

describe('BTC-relative candle derivation', () => {
  it('joins by open time and skips an asset candle with no matching BTC candle', () => {
    const btcCandles = [
      { openTime: 3_000, open: 10, high: 11, low: 9, close: 10.5, volume: 1_000 },
      { openTime: 4_000, open: 10, high: 11, low: 9, close: 10.5, volume: 1_000 },
    ];

    expect(deriveBtcRelativeCandles(assetCandles, btcCandles)).toEqual([
      { openTime: 3_000, open: 4, high: 4, low: 4, close: 4, volume: 200 },
    ]);
  });
});
