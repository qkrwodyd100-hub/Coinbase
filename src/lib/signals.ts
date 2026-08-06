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

export type SignalLabel = '강력 매수' | '매수' | '관망' | '매도' | '강력 매도';

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
  usdKrwRate: number | null;
  fxUnavailable: boolean;
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

  let gains = 0;
  let losses = 0;

  for (let index = 1; index <= period; index += 1) {
    const change = closes[index] - closes[index - 1];
    if (change > 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  let averageGain = gains / period;
  let averageLoss = losses / period;

  for (let index = period + 1; index < closes.length; index += 1) {
    const change = closes[index] - closes[index - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    averageGain = (averageGain * (period - 1) + gain) / period;
    averageLoss = (averageLoss * (period - 1) + loss) / period;
  }

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
    interpretation = '과매도 구간은 RSI 점수를 가장 높게 반영합니다.';
  } else if (value <= 45) {
    score = 20;
    interpretation = '식어가는 모멘텀은 완전한 투매가 아니어도 매력적인 RSI 점수를 줍니다.';
  } else if (value < 60) {
    score = 15;
    interpretation = '중간 범위의 모멘텀은 건설적이지만 큰 할인 구간은 아닙니다.';
  } else if (value < 70) {
    score = 5;
    interpretation = '높아진 모멘텀은 상승 쏠림 가능성 때문에 낮은 점수를 받습니다.';
  } else {
    score = 0;
    interpretation = '과매수 RSI는 점수를 받지 않습니다.';
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
    interpretation = '극단적 공포는 역발상 매집 구간일 수 있습니다.';
  } else if (value <= 45) {
    score = 15;
    interpretation = '공포 심리는 역발상 진입에 여전히 우호적입니다.';
  } else if (value < 60) {
    score = 10;
    interpretation = '균형 잡힌 심리는 중간 점수를 받습니다.';
  } else if (value < 75) {
    score = 5;
    interpretation = '탐욕이 커지고 있어 심리 점수 기여도는 낮습니다.';
  } else {
    score = 0;
    interpretation = '극단적 탐욕은 심리 점수를 받지 않습니다.';
  }

  return {
    id: 'fear-greed',
    title: '공포·탐욕 지수',
    value: value.toFixed(0),
    score,
    maxScore: 20,
    interpretation,
  };
}

export function scoreMovingAverages(price: number, ma20: number, ma50: number, usdKrwRate: number | null = null): IndicatorScore {
  let score: number;
  let interpretation: string;

  if (price > ma20 && price > ma50 && ma20 > ma50) {
    score = 25;
    interpretation = '가격이 두 이동평균 위에 있고 단기 추세가 앞서고 있습니다.';
  } else if (price > ma20) {
    score = 15;
    interpretation = '가격은 MA20 위에 있지만 추세 확인은 엇갈립니다.';
  } else if (price < ma20 && price < ma50 && ma20 < ma50) {
    score = 0;
    interpretation = '가격이 두 이동평균 아래에 있고 단기 추세도 뒤처져 있습니다.';
  } else if (price >= ma20 || price >= ma50) {
    score = 10;
    interpretation = '엇갈린 이동평균 배열에는 정해진 부분 점수를 적용합니다.';
  } else {
    score = 5;
    interpretation = '가격은 이동평균 아래에 있지만 완전한 약세 배열은 아닙니다.';
  }

  return {
    id: 'moving-averages',
    title: '이동평균',
    value: `${formatUsdWithKrw(price, usdKrwRate)} / MA20 ${formatUsdWithKrw(ma20, usdKrwRate)} / MA50 ${formatUsdWithKrw(ma50, usdKrwRate)}`,
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
    interpretation = '중립 또는 음수 펀딩은 과열된 롱 레버리지를 피합니다.';
  } else if (valuePercent <= 0.01) {
    score = 15;
    interpretation = '소폭 양수 펀딩은 허용 가능하지만 매력도는 낮습니다.';
  } else if (valuePercent <= 0.03) {
    score = 5;
    interpretation = '보통 수준의 양수 펀딩은 선물 점수를 낮춥니다.';
  } else {
    score = 0;
    interpretation = '높은 양수 펀딩은 롱 포지션 쏠림을 시사합니다.';
  }

  return {
    id: 'funding',
    title: 'Kraken 선물 펀딩비율',
    value: `${valuePercent.toFixed(4)}%`,
    score,
    maxScore: 25,
    interpretation,
  };
}

export function signalForScore(score: number): Signal {
  if (score >= 80) return { label: '강력 매수', tone: 'positive' };
  if (score >= 60) return { label: '매수', tone: 'positive' };
  if (score >= 41) return { label: '관망', tone: 'neutral' };
  if (score >= 21) return { label: '매도', tone: 'negative' };
  return { label: '강력 매도', tone: 'negative' };
}

export function buildAssetSignal(input: {
  symbol: 'BTC' | 'ETH';
  name: string;
  price: number;
  closes: number[];
  fearGreed: number;
  fundingPercent: number;
  usdKrwRate?: number | null;
  stale?: boolean;
}): AssetSignal {
  const rsi = calculateRsi(input.closes, 14);
  const ma20 = calculateMovingAverage(input.closes, 20);
  const ma50 = calculateMovingAverage(input.closes, 50);
  const indicators = [
    scoreRsi(rsi),
    scoreFearGreed(input.fearGreed),
    scoreMovingAverages(input.price, ma20, ma50, input.usdKrwRate ?? null),
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

export function formatKrw(value: number): string {
  return new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW',
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatUsdWithKrw(value: number, usdKrwRate: number | null): string {
  const usd = formatUsd(value);
  if (usdKrwRate === null) return usd;
  return `${usd} · ${formatKrw(value * usdKrwRate)}`;
}
