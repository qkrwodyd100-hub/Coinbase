import type { BacktestSummaryRow, MarketCandle } from './signals';

export type BacktestSignalType = 'strong-buy' | 'strong-sell';

export type ScoredCandle = {
  candle: MarketCandle;
  score: number;
};

export type BacktestSignal = {
  asset: 'BTC' | 'ETH';
  interval: '4h' | '1d';
  type: BacktestSignalType;
  signalOpenTime: number;
  entryOpenTime: number;
  entryPrice: number;
  closeReturnPercent: number;
  maxFavorablePercent: number;
  maxAdversePercent: number;
  success: boolean;
};

export type BacktestResult = {
  asset: 'BTC' | 'ETH';
  interval: '4h' | '1d';
  horizonMs: number;
  lookAheadRule: string;
  signals: BacktestSignal[];
  excludedSignals: number;
  dataStart: number | null;
  dataEnd: number | null;
};

export type BacktestSummary = {
  generatedAt: string;
  rows: BacktestSummaryRow[];
  dataLimitations: string[];
};

export function runBacktest(input: { asset: 'BTC' | 'ETH'; interval: '4h' | '1d'; horizonMs: number; scoredCandles: ScoredCandle[] }): BacktestResult {
  const signals: BacktestSignal[] = [];
  let previousType: BacktestSignalType | null = null;
  let excludedSignals = 0;

  for (let index = 0; index < input.scoredCandles.length; index += 1) {
    const current = input.scoredCandles[index];
    const type = signalTypeForScore(current.score);
    if (type === null) {
      previousType = null;
      continue;
    }
    if (type === previousType) continue;

    const entry = input.scoredCandles[index + 1];
    if (!entry) {
      excludedSignals += 1;
      previousType = type;
      continue;
    }

    const horizonEnd = entry.candle.openTime + input.horizonMs;
    const evaluationCandles = input.scoredCandles.slice(index + 1).filter((item) => item.candle.openTime <= horizonEnd);
    if (evaluationCandles.length === 0) {
      excludedSignals += 1;
      previousType = type;
      continue;
    }

    signals.push(evaluateSignal(input.asset, input.interval, type, current.candle.openTime, entry.candle.openTime, entry.candle.open, evaluationCandles));
    previousType = type;
  }

  return {
    asset: input.asset,
    interval: input.interval,
    horizonMs: input.horizonMs,
    lookAheadRule: 'Score is calculated after a candle closes; entry uses the next closed candle open/first observable next bar price to avoid look-ahead bias.',
    signals,
    excludedSignals,
    dataStart: input.scoredCandles[0]?.candle.openTime ?? null,
    dataEnd: input.scoredCandles.at(-1)?.candle.openTime ?? null,
  };
}

export function summarizeBacktest(results: BacktestResult[]): BacktestSummary {
  const rows: BacktestSummaryRow[] = [];

  for (const result of results) {
    for (const signalType of ['strong-buy', 'strong-sell'] as const) {
      const signals = result.signals.filter((signal) => signal.type === signalType);
      if (signals.length === 0) continue;
      const hitCount = signals.filter((signal) => signal.success).length;
      rows.push({
        asset: result.asset,
        interval: result.interval,
        signalType,
        signalCount: signals.length,
        hitCount,
        hitRatePercent: roundPercent((hitCount / signals.length) * 100),
        averageCloseReturnPercent: average(signals.map((signal) => signal.closeReturnPercent)),
        averageMaxFavorablePercent: average(signals.map((signal) => signal.maxFavorablePercent)),
        averageMaxAdversePercent: average(signals.map((signal) => signal.maxAdversePercent)),
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    rows,
    dataLimitations: [
      'missing indicators are explicitly excluded and available weights are normalized',
      'missing indicators are explicitly excluded and available weights are normalized; full-data and limited-data results must be compared separately.',
      'public no-key data can have delayed archive files; reports include data start/end and excluded signal counts.',
      'Fear & Greed is daily and is forward-filled for 4h candles by UTC date.',
    ],
  };
}

function evaluateSignal(
  asset: 'BTC' | 'ETH',
  interval: '4h' | '1d',
  type: BacktestSignalType,
  signalOpenTime: number,
  entryOpenTime: number,
  entryPrice: number,
  evaluationCandles: ScoredCandle[],
): BacktestSignal {
  const closeReturnPercent = percentChange(entryPrice, evaluationCandles.at(-1)?.candle.close ?? entryPrice);
  const highest = Math.max(...evaluationCandles.map((item) => item.candle.high));
  const lowest = Math.min(...evaluationCandles.map((item) => item.candle.low));
  const maxUp = percentChange(entryPrice, highest);
  const maxDown = percentChange(entryPrice, lowest);
  const success = type === 'strong-buy' ? maxUp >= 3 : maxDown <= -3;

  return {
    asset,
    interval,
    type,
    signalOpenTime,
    entryOpenTime,
    entryPrice,
    closeReturnPercent: roundPercent(closeReturnPercent),
    maxFavorablePercent: roundPercent(type === 'strong-buy' ? maxUp : -maxDown),
    maxAdversePercent: roundPercent(type === 'strong-buy' ? maxDown : -maxUp),
    success,
  };
}

function signalTypeForScore(score: number): BacktestSignalType | null {
  if (score >= 80) return 'strong-buy';
  if (score <= 20) return 'strong-sell';
  return null;
}

function percentChange(from: number, to: number): number {
  return ((to - from) / from) * 100;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return roundPercent(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}
