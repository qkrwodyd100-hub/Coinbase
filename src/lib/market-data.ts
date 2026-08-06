import { buildAssetSignal, type AssetSignal, type BacktestSummaryRow, type DashboardPayload, type MarketCandle } from './signals';
import backtestSummary from '@/data/backtest-summary.json';

const STATIC_BACKTEST_SUMMARY = backtestSummary as {
  generatedAt: string;
  source: string;
  rows: BacktestSummaryRow[];
  dataLimitations: string[];
};

type AssetConfig = {
  symbol: 'BTC' | 'ETH';
  name: string;
  spotSymbol: 'BTCUSDT' | 'ETHUSDT';
  futuresSymbol: 'BTCUSDT' | 'ETHUSDT';
};

const ASSETS: AssetConfig[] = [
  { symbol: 'BTC', name: '비트코인', spotSymbol: 'BTCUSDT', futuresSymbol: 'BTCUSDT' },
  { symbol: 'ETH', name: '이더리움', spotSymbol: 'ETHUSDT', futuresSymbol: 'ETHUSDT' },
];

const BINANCE_SPOT_BASE = 'https://data-api.binance.vision/api/v3';
const BINANCE_FUTURES_BASE = 'https://fapi.binance.com';
const FEAR_GREED_URL = 'https://api.alternative.me/fng/?limit=1&format=json';
const USD_KRW_URL = 'https://api.frankfurter.app/latest?from=USD&to=KRW';
const REQUEST_TIMEOUT_MS = 8_000;
const REVALIDATE_SECONDS = 55;

export async function getDashboardPayload(): Promise<DashboardPayload> {
  const [fearGreed, usdKrwRate, ethBtcCandles] = await Promise.all([getFearGreedIndex(), getUsdKrwRate(), getSpotCandles('ETHBTC', '1d', 80)]);
  const ethBtcCloses = ethBtcCandles.map((candle) => candle.close);
  const ethBtcCurrent = ethBtcCloses.at(-1);
  const ethBtcMa20 = ethBtcCloses.length >= 20 ? ethBtcCloses.slice(-20).reduce((sum, close) => sum + close, 0) / 20 : undefined;
  const assets = await Promise.all(ASSETS.map((asset) => getAssetSignal(asset, fearGreed, usdKrwRate, ethBtcCurrent, ethBtcMa20)));

  return {
    asOf: new Date().toISOString(),
    usdKrwRate,
    fxUnavailable: usdKrwRate === null,
    assets,
    backtestSummary: STATIC_BACKTEST_SUMMARY,
  };
}

async function getAssetSignal(
  asset: AssetConfig,
  fearGreed: number,
  usdKrwRate: number | null,
  ethBtcCurrent: number | undefined,
  ethBtcMa20: number | undefined,
): Promise<AssetSignal> {
  const [price, candles, fundingPercent, openInterest] = await Promise.all([
    getTickerPrice(asset.spotSymbol),
    getSpotCandles(asset.spotSymbol, '1d', 80),
    getFundingPercent(asset.futuresSymbol),
    getOpenInterestChange(asset.futuresSymbol),
  ]);
  const previousClose = candles.at(-2)?.close ?? candles.at(-1)?.open ?? price;
  const priceChangePercent = ((price - previousClose) / previousClose) * 100;

  return buildAssetSignal({
    symbol: asset.symbol,
    name: asset.name,
    price,
    candles,
    fearGreed,
    fundingPercent,
    oiChangePercent: openInterest?.changePercent,
    priceChangePercent,
    ethBtcCurrent: asset.symbol === 'ETH' ? ethBtcCurrent : undefined,
    ethBtcMa20: asset.symbol === 'ETH' ? ethBtcMa20 : undefined,
    usdKrwRate,
  });
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

async function getTickerPrice(symbol: string): Promise<number> {
  const payload = await fetchJson(`${BINANCE_SPOT_BASE}/ticker/price?symbol=${symbol}`);
  if (!isRecord(payload) || payload.symbol !== symbol) {
    throw new Error(`Unexpected ticker payload for ${symbol}`);
  }

  return parsePositiveFiniteUnknown(payload.price, `${symbol} price`);
}

async function getSpotCandles(symbol: string, interval: '1d' | '4h', limit: number): Promise<MarketCandle[]> {
  const payload = await fetchJson(`${BINANCE_SPOT_BASE}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  if (!Array.isArray(payload)) {
    throw new Error(`Unexpected kline payload for ${symbol}`);
  }

  const candles = payload.map((entry, index) => parseKline(entry, `${symbol}[${index}]`));
  if (candles.length < 51) {
    throw new Error(`Not enough ${symbol} closes to calculate signals.`);
  }

  return candles;
}

async function getFundingPercent(symbol: string): Promise<number | undefined> {
  let payload: unknown;
  try {
    payload = await fetchJson(`${BINANCE_FUTURES_BASE}/fapi/v1/fundingRate?symbol=${symbol}&limit=1`);
  } catch (error) {
    if (error instanceof UpstreamRequestError) return undefined;
    throw error;
  }
  if (!Array.isArray(payload) || !isRecord(payload[0])) {
    throw new Error(`Unexpected funding payload for ${symbol}`);
  }

  const fundingRate = parseBoundedFiniteUnknown(payload[0].fundingRate, `${symbol} funding`, -100, 100);
  return fundingRate * 100;
}

async function getOpenInterestChange(symbol: string): Promise<{ current: number; previous: number; changePercent: number } | undefined> {
  let payload: unknown;
  try {
    payload = await fetchJson(`${BINANCE_FUTURES_BASE}/futures/data/openInterestHist?symbol=${symbol}&period=4h&limit=2`);
  } catch (error) {
    if (error instanceof UpstreamRequestError) return undefined;
    throw error;
  }
  if (!Array.isArray(payload) || payload.length < 2 || !isRecord(payload[0]) || !isRecord(payload[1])) {
    throw new Error(`Unexpected open interest payload for ${symbol}`);
  }

  const previous = parsePositiveFiniteUnknown(payload[0].sumOpenInterest ?? payload[0].sum_open_interest, `${symbol} previous open interest`);
  const current = parsePositiveFiniteUnknown(payload[1].sumOpenInterest ?? payload[1].sum_open_interest, `${symbol} open interest`);
  return { current, previous, changePercent: ((current - previous) / previous) * 100 };
}

async function getFearGreedIndex(): Promise<number> {
  const payload = await fetchJson(FEAR_GREED_URL);
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error('Unexpected Fear & Greed payload.');
  }
  const latest = payload.data[0];
  if (!isRecord(latest) || typeof latest.value !== 'string') {
    throw new Error('Missing latest Fear & Greed value.');
  }

  return parseBoundedFiniteUnknown(latest.value, 'Fear & Greed', 0, 100);
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

function parseKline(entry: unknown, label: string): MarketCandle {
  if (!Array.isArray(entry) || entry.length < 6) {
    throw new Error(`Unexpected kline row for ${label}`);
  }

  return {
    openTime: parseTimestamp(entry[0], `${label} open time`),
    open: parsePositiveFiniteUnknown(entry[1], `${label} open`),
    high: parsePositiveFiniteUnknown(entry[2], `${label} high`),
    low: parsePositiveFiniteUnknown(entry[3], `${label} low`),
    close: parsePositiveFiniteUnknown(entry[4], `${label} close`),
    volume: parsePositiveFiniteUnknown(entry[5], `${label} volume`),
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
