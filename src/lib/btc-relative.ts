import type { MarketCandle } from './signals.ts';

export function deriveBtcRelativeCandles(assetUsd: MarketCandle[], btcUsd: MarketCandle[]): MarketCandle[] {
  const btcByOpenTime = new Map(btcUsd.map((candle) => [candle.openTime, candle]));
  return assetUsd.flatMap((candle) => {
    const btc = btcByOpenTime.get(candle.openTime);
    return btc && btc.open > 0 && btc.high > 0 && btc.low > 0 && btc.close > 0
      ? [{ ...candle, open: candle.open / btc.open, high: candle.high / btc.high, low: candle.low / btc.low, close: candle.close / btc.close }]
      : [];
  });
}
