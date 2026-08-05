export type SignalTone = 'positive' | 'neutral' | 'negative';
export type IndicatorId = 'rsi' | 'fear-greed' | 'moving-averages' | 'funding';

export type IndicatorScore = {
  id: IndicatorId;
  title: string;
  value: string;
  score: number;
  maxScore: number;
  interpretation: string;
};

export type SignalLabel = 'Strong Buy' | 'Buy' | 'Neutral' | 'Sell' | 'Strong Sell';

export type Signal = {
  label: SignalLabel;
  tone: SignalTone;
};

export type AssetSignal = {
  symbol: 'BTC' | 'ETH';
  name: string;
  price: number;
  overallScore: number;
  signal: Signal;
  stale: boolean;
  indicators: IndicatorScore[];
};

export type DashboardPayload = {
  asOf: string;
  assets: AssetSignal[];
};

export function calculateMovingAverage(closes: number[], period: number): number {
  if (!Number.isInteger(period) || period <= 0) {
    throw new Error('Moving average period must be a positive integer.');
  }
  if (closes.length < period) {
    throw new Error(`Need at least ${period} closes to calculate MA${period}.`);
  }

  const window = closes.slice(-period);
  return window.reduce((sum, close) => sum + close, 0) / period;
}

export function calculateRsi(closes: number[], period = 14): number {
  if (!Number.isInteger(period) || period <= 0) {
    throw new Error('RSI period must be a positive integer.');
  }
  if (closes.length < period + 1) {
    throw new Error(`Need at least ${period + 1} closes to calculate RSI(${period}).`);
  }

  const recent = closes.slice(-(period + 1));
  let gains = 0;
  let losses = 0;

  for (let index = 1; index < recent.length; index += 1) {
    const change = recent[index] - recent[index - 1];
    if (change > 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  const averageGain = gains / period;
  const averageLoss = losses / period;

  if (averageLoss === 0) {
    return averageGain === 0 ? 50 : 100;
  }

  const relativeStrength = averageGain / averageLoss;
  return 100 - 100 / (1 + relativeStrength);
}

export function scoreRsi(value: number): IndicatorScore {
  let score: number;
  let interpretation: string;

  if (value <= 30) {
    score = 30;
    interpretation = 'Oversold conditions reward the highest RSI score.';
  } else if (value <= 45) {
    score = 20;
    interpretation = 'Cooling momentum keeps RSI attractive without full capitulation.';
  } else if (value < 60) {
    score = 15;
    interpretation = 'Mid-range momentum is constructive but not deeply discounted.';
  } else if (value < 70) {
    score = 5;
    interpretation = 'Elevated momentum earns a reduced score as upside may be crowded.';
  } else {
    score = 0;
    interpretation = 'Overbought RSI receives no score.';
  }

  return {
    id: 'rsi',
    title: 'RSI (14)',
    value: value.toFixed(2),
    score,
    maxScore: 30,
    interpretation,
  };
}

export function scoreFearGreed(value: number): IndicatorScore {
  let score: number;
  let interpretation: string;

  if (value <= 25) {
    score = 20;
    interpretation = 'Extreme fear can mark contrarian accumulation zones.';
  } else if (value <= 45) {
    score = 15;
    interpretation = 'Fearful sentiment remains supportive for contrarian entries.';
  } else if (value < 60) {
    score = 10;
    interpretation = 'Balanced sentiment receives a middle score.';
  } else if (value < 75) {
    score = 5;
    interpretation = 'Greed is rising, so sentiment contributes only lightly.';
  } else {
    score = 0;
    interpretation = 'Extreme greed receives no sentiment score.';
  }

  return {
    id: 'fear-greed',
    title: 'Fear & Greed',
    value: value.toFixed(0),
    score,
    maxScore: 20,
    interpretation,
  };
}

export function scoreMovingAverages(price: number, ma20: number, ma50: number): IndicatorScore {
  let score: number;
  let interpretation: string;

  if (price > ma20 && price > ma50 && ma20 > ma50) {
    score = 25;
    interpretation = 'Price is above both averages and short-term trend leads.';
  } else if (price > ma20) {
    score = 15;
    interpretation = 'Price is above MA20 but trend confirmation is mixed.';
  } else if (price < ma20 && price < ma50 && ma20 < ma50) {
    score = 0;
    interpretation = 'Price is below both averages while short-term trend lags.';
  } else if (price >= ma20 || price >= ma50) {
    score = 10;
    interpretation = 'Mixed average alignment gets a deterministic partial score.';
  } else {
    score = 5;
    interpretation = 'Price is below the averages, but bearish alignment is not fully confirmed.';
  }

  return {
    id: 'moving-averages',
    title: 'Moving averages',
    value: `${formatUsd(price)} / MA20 ${formatUsd(ma20)} / MA50 ${formatUsd(ma50)}`,
    score,
    maxScore: 25,
    interpretation,
  };
}

export function scoreFunding(valuePercent: number): IndicatorScore {
  let score: number;
  let interpretation: string;

  if (valuePercent <= 0) {
    score = 25;
    interpretation = 'Neutral or negative funding avoids overheated long leverage.';
  } else if (valuePercent <= 0.01) {
    score = 15;
    interpretation = 'Slightly positive funding is acceptable but less attractive.';
  } else if (valuePercent <= 0.03) {
    score = 5;
    interpretation = 'Moderate positive funding reduces the futures score.';
  } else {
    score = 0;
    interpretation = 'High positive funding signals crowded long positioning.';
  }

  return {
    id: 'funding',
    title: 'Futures funding',
    value: `${valuePercent.toFixed(4)}%`,
    score,
    maxScore: 25,
    interpretation,
  };
}

export function signalForScore(score: number): Signal {
  if (score >= 80) return { label: 'Strong Buy', tone: 'positive' };
  if (score >= 60) return { label: 'Buy', tone: 'positive' };
  if (score >= 41) return { label: 'Neutral', tone: 'neutral' };
  if (score >= 21) return { label: 'Sell', tone: 'negative' };
  return { label: 'Strong Sell', tone: 'negative' };
}

export function buildAssetSignal(input: {
  symbol: 'BTC' | 'ETH';
  name: string;
  price: number;
  closes: number[];
  fearGreed: number;
  fundingPercent: number;
  stale?: boolean;
}): AssetSignal {
  const rsi = calculateRsi(input.closes, 14);
  const ma20 = calculateMovingAverage(input.closes, 20);
  const ma50 = calculateMovingAverage(input.closes, 50);
  const indicators = [
    scoreRsi(rsi),
    scoreFearGreed(input.fearGreed),
    scoreMovingAverages(input.price, ma20, ma50),
    scoreFunding(input.fundingPercent),
  ];
  const overallScore = indicators.reduce((total, indicator) => total + indicator.score, 0);

  return {
    symbol: input.symbol,
    name: input.name,
    price: input.price,
    overallScore,
    signal: signalForScore(overallScore),
    stale: input.stale ?? false,
    indicators,
  };
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}
