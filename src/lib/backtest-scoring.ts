import { buildAssetSignal, type AssetSignal, type AssetSymbol, type MarketCandle } from './signals.ts';

export type HistoricalFundingRow = {
  fundingTime: number;
  fundingRatePercent: number;
};

export type HistoricalFearGreedRow = {
  date: string;
  value: number;
};

export type HistoricalOpenInterestRow = {
  timestamp: number;
  openInterest: number;
};

export type HistoricalScoredCandle = {
  candle: MarketCandle;
  score: number;
  signal: AssetSignal;
};

export function scoreBacktestCandles({
  asset,
  candles,
  fearGreed,
  funding,
  openInterest = [],
  timeframe = '4h',
  ethBtcCandles = [],
  altBtcCandles = [],
}: {
  asset: AssetSymbol;
  candles: MarketCandle[];
  fearGreed: HistoricalFearGreedRow[];
  funding: HistoricalFundingRow[];
  openInterest?: HistoricalOpenInterestRow[];
  timeframe?: '4h' | '1d';
  ethBtcCandles?: MarketCandle[];
  altBtcCandles?: MarketCandle[];
}): HistoricalScoredCandle[] {
  const scored: HistoricalScoredCandle[] = [];
  const intervalMs = timeframe === '1d' ? 24 * 60 * 60 * 1000 : 4 * 60 * 60 * 1000;

  for (let index = 50; index < candles.length; index += 1) {
    const candle = candles[index];
    const history = candles.slice(0, index + 1);
    const signalBarClose = candle.openTime + intervalMs;
    const ethHistory = ethBtcCandles.filter((item) => item.openTime + intervalMs <= signalBarClose);
    const altHistory = altBtcCandles.filter((item) => item.openTime + intervalMs <= signalBarClose);
    const previousClose = candles[index - 1]?.close ?? candle.open;
    const oiChangePercent = openInterestChangeForTime(openInterest, signalBarClose);
    const signal = buildAssetSignal({
      symbol: asset,
      name: asset,
      price: candle.close,
      candles: history,
      fearGreed: valueForUtcDate(fearGreed, signalBarClose),
      fundingPercent: fundingForTime(funding, signalBarClose),
      oiChangePercent,
      priceChangePercent: ((candle.close - previousClose) / previousClose) * 100,
      ethBtcCurrent: asset === 'ETH' ? ethHistory.at(-1)?.close : undefined,
      ethBtcMa20: asset === 'ETH' ? averageRecentCloses(ethHistory) : undefined,
      altBtcCurrent: isAlt(asset) ? altHistory.at(-1)?.close : undefined,
      altBtcMa20: isAlt(asset) ? averageRecentCloses(altHistory) : undefined,
      signalTimeframe: timeframe,
      signalBarOpen: new Date(candle.openTime).toISOString(),
      signalBarClose: new Date(signalBarClose).toISOString(),
    });
    scored.push({ candle, score: signal.overallScore, signal });
  }

  return scored;
}

function isAlt(asset: AssetSymbol): boolean {
  return asset !== 'BTC' && asset !== 'ETH';
}

function averageRecentCloses(candles: MarketCandle[]): number | undefined {
  if (candles.length < 20) return undefined;
  return candles.slice(-20).reduce((sum, candle) => sum + candle.close, 0) / 20;
}

function fundingForTime(rows: HistoricalFundingRow[], time: number): number | undefined {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rows[index].fundingTime <= time) return rows[index].fundingRatePercent;
  }
  return undefined;
}

function openInterestChangeForTime(rows: HistoricalOpenInterestRow[], time: number): number | undefined {
  const available = rows.filter((row) => row.timestamp <= time).sort((left, right) => left.timestamp - right.timestamp);
  if (available.length < 2) return undefined;
  const previous = available.at(-2)!.openInterest;
  const current = available.at(-1)!.openInterest;
  return ((current - previous) / previous) * 100;
}

function valueForUtcDate(rows: HistoricalFearGreedRow[], time: number): number | undefined {
  const date = new Date(time).toISOString().slice(0, 10);
  return rows.find((row) => row.date === date)?.value;
}
