export type SignalTone = 'positive' | 'neutral' | 'negative';
export type AssetSymbol = 'BTC' | 'ETH' | 'SHIB' | 'FIL' | 'STX' | 'DOGE' | 'ARB' | 'XRP';
export type AltAssetSymbol = Exclude<AssetSymbol, 'BTC' | 'ETH'>;
export type IndicatorId = 'rsi' | 'fear-greed' | 'moving-averages' | 'funding' | 'mfi' | 'futures-positioning' | 'eth-btc-strength' | 'alt-btc-strength';

export type MarketCandle = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

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
  symbol: AssetSymbol;
  name: string;
  price: number;
  overallScore: number;
  signal: Signal;
  stale: boolean;
  indicators: IndicatorScore[];
  missingFeatures: string[];
  scorePolicy: string;
};

export type BacktestSummaryRow = {
  asset: AssetSymbol;
  interval: '4h' | '1d';
  signalType: 'strong-buy' | 'strong-sell';
  signalCount: number;
  hitCount: number;
  hitRatePercent: number;
  averageCloseReturnPercent: number;
  averageMaxFavorablePercent: number;
  averageMaxAdversePercent: number;
};

export type DashboardPayload = {
  asOf: string;
  usdKrwRate: number | null;
  fxUnavailable: boolean;
  assets: AssetSignal[];
  backtestSummary?: {
    generatedAt: string;
    source: string;
    rows: BacktestSummaryRow[];
    dataLimitations: string[];
  };
};

const SCORE_POLICY = 'missing features are not converted to zero or full credit; available indicator weights are normalized to 100 and limitations are exposed.';

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

export function calculateMfi(candles: MarketCandle[], period = 14): number {
  if (!Number.isInteger(period) || period <= 0) {
    throw new Error('MFI period must be a positive integer.');
  }
  if (candles.length < period + 1) {
    throw new Error(`Need at least ${period + 1} candles to calculate MFI(${period}).`);
  }

  const window = candles.slice(-(period + 1));
  let positiveFlow = 0;
  let negativeFlow = 0;

  for (let index = 1; index < window.length; index += 1) {
    const previousTypical = typicalPrice(window[index - 1]);
    const currentTypical = typicalPrice(window[index]);
    const rawMoneyFlow = currentTypical * window[index].volume;
    if (currentTypical > previousTypical) {
      positiveFlow += rawMoneyFlow;
    } else if (currentTypical < previousTypical) {
      negativeFlow += rawMoneyFlow;
    }
  }

  if (negativeFlow === 0) return positiveFlow === 0 ? 50 : 100;
  const moneyRatio = positiveFlow / negativeFlow;
  return 100 - 100 / (1 + moneyRatio);
}

export function scoreRsi(value: number): IndicatorScore {
  let score: number;
  let interpretation: string;

  if (value <= 30) {
    score = 20;
    interpretation = 'RSI 30 이하는 과매도 구간으로 최대 점수를 부여합니다.';
  } else if (value <= 50) {
    score = 15;
    interpretation = 'RSI 30 초과~50 이하는 식은 모멘텀으로 높은 부분 점수를 부여합니다.';
  } else if (value < 70) {
    score = 5;
    interpretation = 'RSI 50 초과~70 미만은 중립 이상 모멘텀으로 낮은 점수를 부여합니다.';
  } else {
    score = 0;
    interpretation = 'RSI 70 이상 과매수 구간은 점수를 받지 않습니다.';
  }

  return {
    id: 'rsi',
    title: 'RSI (14)',
    value: value.toFixed(2),
    score,
    maxScore: 20,
    interpretation,
  };
}

export function scoreFearGreed(value: number): IndicatorScore {
  let score: number;
  let interpretation: string;

  if (value <= 25) {
    score = 15;
    interpretation = '극단적 공포 구간은 역발상 가산점을 최대로 반영합니다.';
  } else if (value <= 45) {
    score = 12;
    interpretation = '공포 구간은 역발상 진입에 우호적인 심리 점수를 줍니다.';
  } else if (value <= 60) {
    score = 8;
    interpretation = '중립 심리는 중간 심리 점수를 받습니다.';
  } else if (value <= 75) {
    score = 4;
    interpretation = '탐욕 구간은 낮은 심리 점수만 반영합니다.';
  } else {
    score = 0;
    interpretation = '극단적 탐욕 구간은 심리 가산점을 받지 않습니다.';
  }

  return {
    id: 'fear-greed',
    title: '공포·탐욕 지수',
    value: value.toFixed(0),
    score,
    maxScore: 15,
    interpretation,
  };
}

export function scoreAltRsi(value: number): IndicatorScore {
  const score = value <= 25 ? 20 : value <= 50 ? 15 : value < 75 ? 8 : 0;
  const interpretation = value <= 25
    ? 'RSI 25 이하는 알트코인 과매도 구간으로 최대 점수를 부여합니다.'
    : value <= 50
      ? 'RSI 25 초과~50 이하는 식은 모멘텀으로 높은 부분 점수를 부여합니다.'
      : value < 75
        ? 'RSI 50 초과~75 미만은 중립 이상 모멘텀으로 부분 점수를 부여합니다.'
        : 'RSI 75 이상은 알트코인 과열 구간으로 점수를 부여하지 않습니다.';
  return { id: 'rsi', title: 'RSI (14)', value: value.toFixed(2), score, maxScore: 20, interpretation };
}

export function scoreMovingAverages(price: number, ma20: number, ma50: number, usdKrwRate: number | null = null): IndicatorScore {
  const distancePercent = ((price - ma20) / ma20) * 100;
  let score: number;
  let interpretation: string;

  if (ma20 > ma50 && price >= ma20 && distancePercent <= 5) {
    score = 25;
    interpretation = 'MA20이 MA50 위에 있고 현재가의 MA20 이격이 5% 이내라 건강한 상승 정렬로 봅니다.';
  } else if (ma20 > ma50 && price >= ma20 && distancePercent < 15) {
    score = 20;
    interpretation = '상승 정렬은 유지되지만 MA20 이격이 5%를 넘어 일부 과열을 감점합니다.';
  } else if (ma20 > ma50 && price >= ma20) {
    score = 12;
    interpretation = '상승 정렬이지만 MA20 이격이 15% 이상이라 과열 감점을 크게 적용합니다.';
  } else if (ma20 > ma50 && price >= ma50) {
    score = 10;
    interpretation = 'MA20 아래 조정 중이지만 MA50 위에 있어 중간 점수를 부여합니다.';
  } else if (price < ma20 && price < ma50 && ma20 < ma50) {
    score = 0;
    interpretation = '가격이 두 이동평균 아래이고 MA20도 MA50 아래인 약세 정렬입니다.';
  } else {
    score = 5;
    interpretation = '엇갈린 이동평균 배열에는 낮은 결정론적 부분 점수를 적용합니다.';
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

export function scoreAltMovingAverages(price: number, ma20: number, ma50: number, usdKrwRate: number | null = null): IndicatorScore {
  const distancePercent = ((price - ma20) / ma20) * 100;
  const score = ma20 > ma50 && price >= ma20 && distancePercent <= 5 ? 20 : ma20 > ma50 && price >= ma20 && distancePercent <= 10 ? 15 : ma20 > ma50 && price >= ma20 ? 8 : ma20 > ma50 && price >= ma50 ? 5 : 0;
  const interpretation = score === 20 ? 'MA20 > MA50, 현재가가 MA20 위이며 이격 5% 이내의 상승 정렬입니다.' : score === 15 ? '상승 정렬이나 MA20 이격이 5% 초과~10% 이하로 과열을 일부 반영합니다.' : score === 8 ? '상승 정렬이나 MA20 이격이 10%를 넘어 과열 위험을 반영합니다.' : score === 5 ? 'MA20 아래 조정 중이나 MA50 위에 있어 제한된 추세 점수를 부여합니다.' : '가격과 MA20이 MA50 아래인 약세 정렬로 추세 점수를 부여하지 않습니다.';
  return { id: 'moving-averages', title: '알트 이동평균', value: `${formatUsdWithKrw(price, usdKrwRate)} / MA20 ${formatUsdWithKrw(ma20, usdKrwRate)} / MA50 ${formatUsdWithKrw(ma50, usdKrwRate)}`, score, maxScore: 20, interpretation };
}

export function scoreMfi(value: number): IndicatorScore {
  let score: number;
  let interpretation: string;

  if (value <= 20) {
    score = 20;
    interpretation = 'MFI 20 이하는 거래량이 동반된 과매도 구간으로 봅니다.';
  } else if (value <= 35) {
    score = 16;
    interpretation = 'MFI 20 초과~35 이하는 자금 흐름이 식은 구간으로 높은 점수를 줍니다.';
  } else if (value <= 60) {
    score = 12;
    interpretation = '중립권 자금 흐름은 중간 점수를 받습니다.';
  } else if (value < 80) {
    score = 5;
    interpretation = '높은 MFI는 과열 가능성 때문에 낮은 점수를 받습니다.';
  } else {
    score = 0;
    interpretation = 'MFI 80 이상은 거래량 동반 과매수 구간으로 점수를 받지 않습니다.';
  }

  return {
    id: 'mfi',
    title: '자금 흐름 MFI (14)',
    value: value.toFixed(2),
    score,
    maxScore: 20,
    interpretation,
  };
}

export function scoreAltMfiWithVolume(input: { mfi: number; volume: number; previousVolume?: number }): IndicatorScore {
  const base = scoreMfi(input.mfi);
  const volumeSurge = input.previousVolume !== undefined && input.volume >= input.previousVolume * 2;
  return { ...base, title: '알트 자금 흐름 MFI (14)', score: Math.min(25, base.score + (volumeSurge ? 5 : 0)), maxScore: 25, interpretation: `${base.interpretation}${volumeSurge ? ' 직전 동일 시간대 캔들 대비 거래량 200% 이상으로 5점 보너스를 적용합니다.' : ' 거래량 보너스는 직전 동일 시간대 캔들 대비 200% 이상일 때만 적용합니다.'}` };
}

export function scoreFunding(valuePercent: number): IndicatorScore {
  let score: number;
  let interpretation: string;

  if (valuePercent <= 0) {
    score = 10;
    interpretation = '음수 또는 중립 펀딩은 과열된 롱 레버리지를 피하므로 높은 점수를 줍니다.';
  } else if (valuePercent <= 0.01) {
    score = 8;
    interpretation = '0.01% 이하의 소폭 양수 펀딩은 허용 가능한 선물 환경입니다.';
  } else if (valuePercent <= 0.03) {
    score = 4;
    interpretation = '중간 양수 펀딩은 선물 점수를 낮춥니다.';
  } else {
    score = 0;
    interpretation = '높은 양수 펀딩은 롱 포지션 쏠림을 시사합니다.';
  }

  return {
    id: 'funding',
    title: 'Binance 선물 펀딩비율',
    value: `${valuePercent.toFixed(4)}%`,
    score,
    maxScore: 10,
    interpretation,
  };
}

export function scoreFuturesPositioning(input: { fundingPercent: number; oiChangePercent?: number; priceChangePercent?: number }): IndicatorScore {
  const funding = scoreFunding(input.fundingPercent);
  let oiScore = 0;
  let oiText = 'OI 결측: funding 가중치만 사용합니다.';

  if (input.oiChangePercent !== undefined && input.priceChangePercent !== undefined) {
    if (input.fundingPercent > 0.03 && input.oiChangePercent > 0) {
      oiScore = 2;
      oiText = '높은 양수 펀딩과 OI 증가가 겹쳐 레버리지 과열로 크게 감점합니다.';
    } else if (input.oiChangePercent > 0 && input.priceChangePercent > 0) {
      oiScore = 10;
      oiText = '가격 상승과 OI 증가가 함께 나타나 추세 참여가 확인됩니다.';
    } else if (input.oiChangePercent < 0 && input.priceChangePercent > 0) {
      oiScore = 6;
      oiText = '가격은 상승하지만 OI가 줄어 일부 숏커버 가능성을 반영합니다.';
    } else if (input.oiChangePercent > 0 && input.priceChangePercent < 0) {
      oiScore = 0;
      oiText = '가격 하락과 OI 증가는 하락 포지션 강화로 보고 감점합니다.';
    } else {
      oiScore = 4;
      oiText = '가격과 OI 방향성이 강하지 않아 낮은 부분 점수를 적용합니다.';
    }
  }

  return {
    id: 'futures-positioning',
    title: '선물 펀딩비·미체결약정',
    value:
      input.oiChangePercent === undefined
        ? `${input.fundingPercent.toFixed(4)}% / OI 결측`
        : `${input.fundingPercent.toFixed(4)}% / OI ${input.oiChangePercent.toFixed(2)}%`,
    score: funding.score + oiScore,
    maxScore: input.oiChangePercent === undefined ? 10 : 20,
    interpretation: `${funding.interpretation} ${oiText}`,
  };
}

export function normalizeEthBtcStrengthScore(current: number, ma20: number): number {
  if (current <= 0 || ma20 <= 0) {
    throw new Error('ETH/BTC values must be positive.');
  }
  const distancePercent = ((current - ma20) / ma20) * 100;
  if (distancePercent >= 2) return 100;
  if (distancePercent <= -2) return 0;
  return Math.round(((distancePercent + 2) / 4) * 100);
}

export function scoreEthBtcStrength(current: number, ma20: number): IndicatorScore {
  const score = normalizeEthBtcStrengthScore(current, ma20);
  return {
    id: 'eth-btc-strength',
    title: 'ETH/BTC 상대강도',
    value: `${current.toFixed(6)} / MA20 ${ma20.toFixed(6)}`,
    score,
    maxScore: 100,
    interpretation: 'ETH 최종 점수는 기본 점수 95%와 ETH/BTC 20봉 상대강도 정규화 점수 5%를 혼합합니다.',
  };
}

export function scoreAltBtcStrength(current: number, ma20: number): IndicatorScore {
  if (current <= 0 || ma20 <= 0) throw new Error('ALT/BTC values must be positive.');
  const distancePercent = ((current - ma20) / ma20) * 100;
  const score = distancePercent >= 2 ? 15 : distancePercent <= -2 ? 0 : distancePercent >= 0 ? 8 : 4;
  return { id: 'alt-btc-strength', title: 'ALT/BTC 상대강도', value: `${current.toFixed(8)} / MA20 ${ma20.toFixed(8)}`, score, maxScore: 15, interpretation: 'ALT/BTC가 MA20보다 2% 이상 강하면 15점, 2% 이상 약하면 0점이며 중간 구간은 방향별 부분 점수입니다.' };
}

export function signalForScore(score: number): Signal {
  if (score >= 80) return { label: '강력 매수', tone: 'positive' };
  if (score >= 60) return { label: '매수', tone: 'positive' };
  if (score >= 41) return { label: '관망', tone: 'neutral' };
  if (score >= 21) return { label: '매도', tone: 'negative' };
  return { label: '강력 매도', tone: 'negative' };
}

export function buildAssetSignal(input: {
  symbol: AssetSymbol;
  name: string;
  price: number;
  closes?: number[];
  candles?: MarketCandle[];
  fearGreed?: number;
  fundingPercent?: number;
  oiChangePercent?: number;
  priceChangePercent?: number;
  ethBtcCurrent?: number;
  ethBtcMa20?: number;
  altBtcCurrent?: number;
  altBtcMa20?: number;
  usdKrwRate?: number | null;
  stale?: boolean;
}): AssetSignal {
  const closes = input.candles?.map((candle) => candle.close) ?? input.closes;
  if (!closes) {
    throw new Error('Need closes or candles to build asset signals.');
  }

  const rsi = calculateRsi(closes, 14);
  const ma20 = calculateMovingAverage(closes, 20);
  const ma50 = calculateMovingAverage(closes, 50);
  const isAlt = input.symbol !== 'BTC' && input.symbol !== 'ETH';
  const indicators = [
    isAlt ? scoreAltMovingAverages(input.price, ma20, ma50, input.usdKrwRate ?? null) : scoreMovingAverages(input.price, ma20, ma50, input.usdKrwRate ?? null),
    isAlt ? scoreAltRsi(rsi) : scoreRsi(rsi),
  ];
  const missingFeatures: string[] = [];

  if (input.candles) {
    indicators.push(isAlt ? scoreAltMfiWithVolume({ mfi: calculateMfi(input.candles, 14), volume: input.candles.at(-1)!.volume, previousVolume: input.candles.at(-2)?.volume }) : scoreMfi(calculateMfi(input.candles, 14)));
  } else {
    missingFeatures.push('mfi');
  }

  if (input.fundingPercent === undefined) {
    missingFeatures.push('funding', 'open-interest');
  } else {
    indicators.push(
      scoreFuturesPositioning({
        fundingPercent: input.fundingPercent,
        oiChangePercent: input.oiChangePercent,
        priceChangePercent: input.priceChangePercent,
      }),
    );
  }
  if (input.fundingPercent !== undefined && (input.oiChangePercent === undefined || input.priceChangePercent === undefined)) {
    missingFeatures.push('open-interest');
  }
  if (!isAlt && input.fearGreed === undefined) {
    missingFeatures.push('fear-greed');
  } else if (!isAlt) {
    indicators.push(scoreFearGreed(input.fearGreed!));
  }

  const rawScore = indicators.reduce((total, indicator) => total + indicator.score, 0);
  const availableMaxScore = indicators.reduce((total, indicator) => total + indicator.maxScore, 0);
  const baseScore = clampScore(Math.round((rawScore / availableMaxScore) * 100));
  const ethBtcIndicator =
    input.symbol === 'ETH' && input.ethBtcCurrent !== undefined && input.ethBtcMa20 !== undefined
      ? scoreEthBtcStrength(input.ethBtcCurrent, input.ethBtcMa20)
      : null;
  const altBtcIndicator = isAlt && input.altBtcCurrent !== undefined && input.altBtcMa20 !== undefined ? scoreAltBtcStrength(input.altBtcCurrent, input.altBtcMa20) : null;
  if (isAlt && !altBtcIndicator) missingFeatures.push('alt-btc-strength');
  const altScore = altBtcIndicator ? clampScore(Math.round(((rawScore + altBtcIndicator.score) / (availableMaxScore + altBtcIndicator.maxScore)) * 100)) : baseScore;
  const overallScore = ethBtcIndicator ? clampScore(Math.round(baseScore * 0.95 + ethBtcIndicator.score * 0.05)) : isAlt ? altScore : baseScore;

  return {
    symbol: input.symbol,
    name: input.name,
    price: input.price,
    overallScore,
    signal: signalForScore(overallScore),
    stale: input.stale ?? false,
    indicators: ethBtcIndicator ? [...indicators, ethBtcIndicator] : altBtcIndicator ? [...indicators, altBtcIndicator] : indicators,
    missingFeatures,
    scorePolicy: SCORE_POLICY,
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

function typicalPrice(candle: MarketCandle): number {
  return (candle.high + candle.low + candle.close) / 3;
}

function clampScore(score: number): number {
  return Math.min(100, Math.max(0, score));
}
