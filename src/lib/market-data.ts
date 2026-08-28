import { buildAssetSignal, type AssetSignal, type AssetSymbol, type BacktestReport, type BacktestSummaryRow, type DashboardPayload, type FeatureObservation, type FeatureTimeframe, type MarketCandle, type SignalFeatureId } from './signals';
import { deriveBtcRelativeCandles } from './btc-relative';
import backtestSummary from '@/data/backtest-summary.json';

const STATIC_BACKTEST_SUMMARY = backtestSummary as {
  generatedAt: string;
  source: string;
  rows: BacktestSummaryRow[];
  dataLimitations: string[];
  reports: BacktestReport[];
};

type AssetConfig = {
  symbol: AssetSymbol;
  name: string;
  spotSymbol: string;
  futuresSymbol: string;
  btcSymbol?: string;
};

type SourceCandle = MarketCandle & { closeTime: number };
type TimedValue<T> = { value: T; observedAt: number; availableAt: number };

const ASSETS: AssetConfig[] = [
  { symbol: 'BTC', name: '비트코인', spotSymbol: 'BTCUSDT', futuresSymbol: 'BTCUSDT' },
  { symbol: 'ETH', name: '이더리움', spotSymbol: 'ETHUSDT', futuresSymbol: 'ETHUSDT' },
  { symbol: 'SHIB', name: '시바이누', spotSymbol: 'SHIBUSDT', futuresSymbol: 'SHIBUSDT' },
  { symbol: 'FIL', name: '파일코인', spotSymbol: 'FILUSDT', futuresSymbol: 'FILUSDT', btcSymbol: 'FILBTC' },
  { symbol: 'STX', name: '스택스', spotSymbol: 'STXUSDT', futuresSymbol: 'STXUSDT', btcSymbol: 'STXBTC' },
  { symbol: 'DOGE', name: '도지코인', spotSymbol: 'DOGEUSDT', futuresSymbol: 'DOGEUSDT', btcSymbol: 'DOGEBTC' },
  { symbol: 'ARB', name: '아비트럼', spotSymbol: 'ARBUSDT', futuresSymbol: 'ARBUSDT', btcSymbol: 'ARBBTC' },
  { symbol: 'XRP', name: '엑스알피', spotSymbol: 'XRPUSDT', futuresSymbol: 'XRPUSDT', btcSymbol: 'XRPBTC' },
];

const BINANCE_SPOT_BASE = 'https://data-api.binance.vision/api/v3';
const BINANCE_FUTURES_BASE = 'https://fapi.binance.com';
const FEAR_GREED_URL = 'https://api.alternative.me/fng/?limit=1&format=json';
const USD_KRW_URL = 'https://api.frankfurter.app/latest?from=USD&to=KRW';
const REQUEST_TIMEOUT_MS = 8_000;
const REVALIDATE_SECONDS = 55;
const DAY_MS = 24 * 60 * 60 * 1000;
const SIGNAL_SNAPSHOT_MAX_AGE_MS = 26 * 60 * 60 * 1000;

export const FEATURE_MAX_AGE_MS = {
  spot: 5 * 60 * 1000,
  relative: 5 * 60 * 1000,
  funding: 12 * 60 * 60 * 1000,
  openInterest: 8 * 60 * 60 * 1000,
  fearGreed: 48 * 60 * 60 * 1000,
} as const;

export async function getDashboardPayload(now = Date.now()): Promise<DashboardPayload> {
  const clockCandles = await getSpotCandles('BTCUSDT', '1d', 80, now, now);
  const signalBarClose = clockCandles.at(-1)!.closeTime + 1;
  const [fearGreed, usdKrwRate, ethBtcCandles] = await Promise.all([
    getFearGreedIndex(signalBarClose),
    getUsdKrwRate(),
    getSpotCandles('ETHBTC', '1d', 80, now, signalBarClose),
  ]);
  const ethBtcStrength = relativeStrengthForCandles(ethBtcCandles);
  const assets = await Promise.all(ASSETS.map((asset) => getAssetSignal(asset, fearGreed, usdKrwRate, ethBtcStrength, now, signalBarClose)));
  const signalBarCloseIso = new Date(signalBarClose).toISOString();

  return {
    asOf: new Date(now).toISOString(),
    signalTimeframe: '1d',
    signalBarClose: signalBarCloseIso,
    nextExecutableAt: signalBarCloseIso,
    usdKrwRate,
    fxUnavailable: usdKrwRate === null,
    assets,
    backtestSummary: STATIC_BACKTEST_SUMMARY,
  };
}

async function getAssetSignal(
  asset: AssetConfig,
  fearGreed: TimedValue<number> | undefined,
  usdKrwRate: number | null,
  ethBtcStrength: TimedValue<{ current: number; ma20: number }> | undefined,
  now: number,
  signalBarClose: number,
): Promise<AssetSignal> {
  const [candles, fundingPercent, openInterest, altBtcCandles] = await Promise.all([
    getSpotCandles(asset.spotSymbol, '1d', 80, now, signalBarClose),
    getFundingPercent(asset.futuresSymbol, signalBarClose),
    getOpenInterestChange(asset.futuresSymbol, signalBarClose),
    getAltBtcCandles(asset, now, signalBarClose).catch(() => []),
  ]);
  const price = candles.at(-1)!.close;
  const previousClose = candles.at(-2)?.close ?? candles.at(-1)!.open;
  const priceChangePercent = ((price - previousClose) / previousClose) * 100;
  const spotAvailableAt = candles.at(-1)!.closeTime + 1;
  const altBtcStrength = relativeStrengthForCandles(altBtcCandles);
  const features = buildFeatureObservations(asset, signalBarClose, spotAvailableAt, fearGreed, fundingPercent, openInterest, ethBtcStrength, altBtcStrength);
  const fundingFeature = features.find((feature) => feature.id === 'funding');
  const openInterestFeature = features.find((feature) => feature.id === 'open-interest');
  const fearGreedFeature = features.find((feature) => feature.id === 'fear-greed');
  const ethBtcFeature = features.find((feature) => feature.id === 'eth-btc-strength');
  const altBtcFeature = features.find((feature) => feature.id === 'alt-btc-strength');
  const signalBarOpen = signalBarClose - DAY_MS;
  const stale = now - signalBarClose > SIGNAL_SNAPSHOT_MAX_AGE_MS || features.some((feature) => feature.status === 'stale');

  return buildAssetSignal({
    symbol: asset.symbol,
    name: asset.name,
    price,
    candles,
    fearGreed: isAvailable(fearGreedFeature) ? fearGreed?.value : undefined,
    fundingPercent: isAvailable(fundingFeature) ? fundingPercent?.value : undefined,
    oiChangePercent: isAvailable(openInterestFeature) ? openInterest?.value.changePercent : undefined,
    priceChangePercent,
    ethBtcCurrent: asset.symbol === 'ETH' && isAvailable(ethBtcFeature) ? ethBtcStrength?.value.current : undefined,
    ethBtcMa20: asset.symbol === 'ETH' && isAvailable(ethBtcFeature) ? ethBtcStrength?.value.ma20 : undefined,
    altBtcCurrent: isAvailable(altBtcFeature) ? altBtcStrength?.value.current : undefined,
    altBtcMa20: isAvailable(altBtcFeature) ? altBtcStrength?.value.ma20 : undefined,
    usdKrwRate,
    stale,
    signalTimeframe: '1d',
    signalBarOpen: new Date(signalBarOpen).toISOString(),
    signalBarClose: new Date(signalBarClose).toISOString(),
    features,
  });
}

async function getAltBtcCandles(asset: AssetConfig, now: number, signalBarClose: number): Promise<SourceCandle[]> {
  if (asset.symbol === 'SHIB') {
    const [shibUsd, btcUsd] = await Promise.all([getSpotCandles('SHIBUSDT', '1d', 80, now, signalBarClose), getSpotCandles('BTCUSDT', '1d', 80, now, signalBarClose)]);
    return deriveBtcRelativeCandles(shibUsd, btcUsd).map((candle) => ({ ...candle, closeTime: candle.openTime + DAY_MS - 1 }));
  }
  return asset.btcSymbol ? getSpotCandles(asset.btcSymbol, '1d', 80, now, signalBarClose) : [];
}

async function getUsdKrwRate(): Promise<number | null> {
  try {
    const payload = await fetchJson(USD_KRW_URL);
    if (!isRecord(payload) || payload.base !== 'USD' || payload.amount !== 1 || !isRecord(payload.rates)) {
      return null;
    }

    return parsePositiveFiniteUnknown(payload.rates.KRW, 'USD to KRW exchange rate');
  } catch {
    return null;
  }
}

async function getSpotCandles(symbol: string, interval: '1d' | '4h', limit: number, now: number, signalBarClose: number): Promise<SourceCandle[]> {
  const payload = await fetchJson(`${BINANCE_SPOT_BASE}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  if (!Array.isArray(payload)) {
    throw new Error(`Unexpected kline payload for ${symbol}`);
  }

  const candles = payload
    .map((entry, index) => parseKline(entry, `${symbol}[${index}]`))
    .filter((candle) => candle.closeTime < now && candle.closeTime + 1 <= signalBarClose);
  if (candles.length < 51) {
    throw new Error(`Not enough ${symbol} closes to calculate signals.`);
  }

  return candles;
}

async function getFundingPercent(symbol: string, signalBarClose: number): Promise<TimedValue<number> | undefined> {
  let payload: unknown;
  try {
    payload = await fetchJson(`${BINANCE_FUTURES_BASE}/fapi/v1/fundingRate?symbol=${symbol}&limit=10`);
  } catch (error) {
    if (error instanceof UpstreamRequestError) return undefined;
    throw error;
  }
  if (!Array.isArray(payload)) {
    throw new Error(`Unexpected funding payload for ${symbol}`);
  }
  const rows = payload.map((row, index) => {
    if (!isRecord(row)) throw new Error(`Unexpected funding payload for ${symbol}[${index}]`);
    const fundingTime = parseTimestamp(row.fundingTime, `${symbol} funding time`);
    const fundingRate = parseBoundedFiniteUnknown(row.fundingRate, `${symbol} funding`, -100, 100) * 100;
    return { value: fundingRate, observedAt: fundingTime, availableAt: fundingTime };
  }).filter((row) => row.availableAt <= signalBarClose);
  return rows.sort((left, right) => left.availableAt - right.availableAt).at(-1);
}

async function getOpenInterestChange(symbol: string, signalBarClose: number): Promise<TimedValue<{ current: number; previous: number; changePercent: number }> | undefined> {
  let payload: unknown;
  try {
    payload = await fetchJson(`${BINANCE_FUTURES_BASE}/futures/data/openInterestHist?symbol=${symbol}&period=4h&limit=8`);
  } catch (error) {
    if (error instanceof UpstreamRequestError) return undefined;
    throw error;
  }
  if (!Array.isArray(payload)) {
    throw new Error(`Unexpected open interest payload for ${symbol}`);
  }
  const rows = payload.map((row, index) => {
    if (!isRecord(row)) throw new Error(`Unexpected open interest payload for ${symbol}[${index}]`);
    return {
      openInterest: parsePositiveFiniteUnknown(row.sumOpenInterest ?? row.sum_open_interest, `${symbol} open interest`),
      timestamp: parseTimestamp(row.timestamp, `${symbol} open interest time`),
    };
  }).filter((row) => row.timestamp <= signalBarClose).sort((left, right) => left.timestamp - right.timestamp);
  if (rows.length < 2) return undefined;
  const previous = rows.at(-2)!.openInterest;
  const current = rows.at(-1)!.openInterest;
  const observedAt = rows.at(-1)!.timestamp;
  return { value: { current, previous, changePercent: ((current - previous) / previous) * 100 }, observedAt, availableAt: observedAt };
}

async function getFearGreedIndex(signalBarClose: number): Promise<TimedValue<number> | undefined> {
  const payload = await fetchJson(FEAR_GREED_URL.replace('limit=1', 'limit=3'));
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error('Unexpected Fear & Greed payload.');
  }
  const rows = payload.data.map((row, index) => {
    if (!isRecord(row) || typeof row.value !== 'string') throw new Error(`Missing Fear & Greed value at index ${index}.`);
    const observedAt = parseTimestamp(row.timestamp, `Fear & Greed timestamp at index ${index}`) * 1000;
    return { value: parseBoundedFiniteUnknown(row.value, 'Fear & Greed', 0, 100), observedAt, availableAt: observedAt };
  }).filter((row) => row.availableAt <= signalBarClose);
  return rows.sort((left, right) => left.availableAt - right.availableAt).at(-1);
}

function relativeStrengthForCandles(candles: SourceCandle[]): TimedValue<{ current: number; ma20: number }> | undefined {
  if (candles.length < 20) return undefined;
  const current = candles.at(-1)!.close;
  const ma20 = candles.slice(-20).reduce((sum, candle) => sum + candle.close, 0) / 20;
  const observedAt = candles.at(-1)!.closeTime + 1;
  return { value: { current, ma20 }, observedAt, availableAt: observedAt };
}

function buildFeatureObservations(
  asset: AssetConfig,
  signalBarClose: number,
  spotAvailableAt: number,
  fearGreed: TimedValue<number> | undefined,
  funding: TimedValue<number> | undefined,
  openInterest: TimedValue<unknown> | undefined,
  ethBtcStrength: TimedValue<unknown> | undefined,
  altBtcStrength: TimedValue<unknown> | undefined,
): FeatureObservation[] {
  const spot = { value: true, observedAt: spotAvailableAt, availableAt: spotAvailableAt };
  const features = (['price', 'moving-averages', 'rsi', 'mfi'] as const).map((id) =>
    featureObservation(id, 'binance-spot-klines', '1d', spot, FEATURE_MAX_AGE_MS.spot, signalBarClose),
  );
  features.push(
    featureObservation('funding', 'binance-usdm-funding', '8h', funding, FEATURE_MAX_AGE_MS.funding, signalBarClose),
    featureObservation('open-interest', 'binance-usdm-open-interest', '4h', openInterest, FEATURE_MAX_AGE_MS.openInterest, signalBarClose),
  );
  if (asset.symbol === 'BTC' || asset.symbol === 'ETH') {
    features.push(featureObservation('fear-greed', 'alternative-me-fear-greed', '1d', fearGreed, FEATURE_MAX_AGE_MS.fearGreed, signalBarClose));
  }
  if (asset.symbol === 'ETH') {
    features.push(featureObservation('eth-btc-strength', 'binance-spot-klines', '1d', ethBtcStrength, FEATURE_MAX_AGE_MS.relative, signalBarClose));
  } else if (asset.symbol !== 'BTC') {
    features.push(featureObservation('alt-btc-strength', 'binance-spot-klines', '1d', altBtcStrength, FEATURE_MAX_AGE_MS.relative, signalBarClose));
  }
  return features;
}

function featureObservation(
  id: SignalFeatureId,
  source: string,
  timeframe: FeatureTimeframe,
  observation: TimedValue<unknown> | undefined,
  maxAgeMs: number,
  signalBarClose: number,
): FeatureObservation {
  if (!observation) {
    return { id, source, timeframe, observedAt: null, availableAt: null, maxAgeMs, status: 'missing' };
  }
  const status = observation.availableAt > signalBarClose || signalBarClose - observation.availableAt > maxAgeMs ? 'stale' : 'available';
  return {
    id,
    source,
    timeframe,
    observedAt: new Date(observation.observedAt).toISOString(),
    availableAt: new Date(observation.availableAt).toISOString(),
    maxAgeMs,
    status,
  };
}

function isAvailable(feature: FeatureObservation | undefined): boolean {
  return feature?.status === 'available';
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { accept: 'application/json' },
        next: { revalidate: REVALIDATE_SECONDS },
        signal: controller.signal,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown network error';
      throw new UpstreamRequestError(`Request failed for ${url}: ${detail}`);
    }

    if (!response.ok) {
      throw new UpstreamRequestError(`Request failed ${response.status} for ${url}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

class UpstreamRequestError extends Error {}

function parseKline(entry: unknown, label: string): SourceCandle {
  if (!Array.isArray(entry) || entry.length < 7) {
    throw new Error(`Unexpected kline row for ${label}`);
  }

  return {
    openTime: parseTimestamp(entry[0], `${label} open time`),
    open: parsePositiveFiniteUnknown(entry[1], `${label} open`),
    high: parsePositiveFiniteUnknown(entry[2], `${label} high`),
    low: parsePositiveFiniteUnknown(entry[3], `${label} low`),
    close: parsePositiveFiniteUnknown(entry[4], `${label} close`),
    volume: parsePositiveFiniteUnknown(entry[5], `${label} volume`),
    closeTime: parseTimestamp(entry[6], `${label} close time`),
  };
}

function parseTimestamp(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive timestamp.`);
  }
  return parsed > 1e15 ? Math.trunc(parsed / 1000) : parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parsePositiveFiniteUnknown(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} is not a finite number.`);
  }
  if (parsed <= 0) {
    throw new Error(`${label} must be greater than zero.`);
  }
  return parsed;
}

function parseBoundedFiniteUnknown(value: unknown, label: string, minimum: number, maximum: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}