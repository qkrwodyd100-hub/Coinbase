import { buildAssetSignal, type AssetSignal, type DashboardPayload } from './signals';

type AssetConfig = {
  symbol: 'BTC' | 'ETH';
  name: string;
  krakenPair: 'XBTUSD' | 'ETHUSD';
  fundingSymbol: 'PF_XBTUSD' | 'PF_ETHUSD';
};

const ASSETS: AssetConfig[] = [
  { symbol: 'BTC', name: 'Bitcoin', krakenPair: 'XBTUSD', fundingSymbol: 'PF_XBTUSD' },
  { symbol: 'ETH', name: 'Ethereum', krakenPair: 'ETHUSD', fundingSymbol: 'PF_ETHUSD' },
];

const KRAKEN_BASE = 'https://api.kraken.com/0/public';
const KRAKEN_FUTURES_BASE = 'https://futures.kraken.com/derivatives/api/v3';
const FEAR_GREED_URL = 'https://api.alternative.me/fng/?limit=1&format=json';
const REQUEST_TIMEOUT_MS = 8_000;
const REVALIDATE_SECONDS = 55;

export async function getDashboardPayload(): Promise<DashboardPayload> {
  const fearGreed = await getFearGreedIndex();
  const assets = await Promise.all(ASSETS.map((asset) => getAssetSignal(asset, fearGreed)));

  return {
    asOf: new Date().toISOString(),
    assets,
  };
}

async function getAssetSignal(asset: AssetConfig, fearGreed: number): Promise<AssetSignal> {
  const [price, closes, fundingPercent] = await Promise.all([
    getTickerPrice(asset.krakenPair),
    getDailyCloses(asset.krakenPair),
    getFundingPercent(asset.fundingSymbol),
  ]);

  return buildAssetSignal({
    symbol: asset.symbol,
    name: asset.name,
    price,
    closes,
    fearGreed,
    fundingPercent,
  });
}

async function getTickerPrice(symbol: string): Promise<number> {
  const ticker = getKrakenResultEntry(await fetchJson(`${KRAKEN_BASE}/Ticker?pair=${symbol}`), symbol);
  if (!isRecord(ticker) || !Array.isArray(ticker.c) || typeof ticker.c[0] !== 'string') {
    throw new Error(`Unexpected ticker payload for ${symbol}`);
  }

  return parsePositiveFiniteNumber(ticker.c[0], `${symbol} price`);
}

async function getDailyCloses(symbol: string): Promise<number[]> {
  const candles = getKrakenResultEntry(await fetchJson(`${KRAKEN_BASE}/OHLC?pair=${symbol}&interval=1440`), symbol);
  if (!Array.isArray(candles)) {
    throw new Error(`Unexpected kline payload for ${symbol}`);
  }

  const closes = candles.slice(-80).map((entry, index) => {
    if (!Array.isArray(entry) || typeof entry[4] !== 'string') {
      throw new Error(`Unexpected kline close at ${symbol}[${index}]`);
    }
    return parsePositiveFiniteNumber(entry[4], `${symbol} close`);
  });

  if (closes.length < 51) {
    throw new Error(`Not enough ${symbol} closes to calculate signals.`);
  }

  return closes;
}

async function getFundingPercent(symbol: string): Promise<number> {
  const payload = await fetchJson(`${KRAKEN_FUTURES_BASE}/tickers/${symbol}`);
  if (!isRecord(payload) || payload.result !== 'success' || !isRecord(payload.ticker) || typeof payload.ticker.fundingRate !== 'number') {
    throw new Error(`Unexpected funding payload for ${symbol}`);
  }

  return parseBoundedNumber(payload.ticker.fundingRate, `${symbol} funding`, -100, 100);
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

  return parseBoundedFiniteNumber(latest.value, 'Fear & Greed', 0, 100);
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      next: { revalidate: REVALIDATE_SECONDS },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Request failed ${response.status} for ${url}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getKrakenResultEntry(payload: unknown, symbol: string): unknown {
  if (!isRecord(payload) || !Array.isArray(payload.error) || payload.error.length > 0 || !isRecord(payload.result)) {
    throw new Error(`Unexpected Kraken payload for ${symbol}`);
  }

  return Object.entries(payload.result).find(([key]) => key !== 'last')?.[1];
}

function parseFiniteNumber(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} is not a finite number.`);
  }
  return parsed;
}

function parsePositiveFiniteNumber(value: string, label: string): number {
  const parsed = parseFiniteNumber(value, label);
  if (parsed <= 0) {
    throw new Error(`${label} must be greater than zero.`);
  }
  return parsed;
}

function parseBoundedFiniteNumber(value: string, label: string, minimum: number, maximum: number): number {
  const parsed = parseFiniteNumber(value, label);
  if (parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function parseBoundedNumber(value: number, label: string, minimum: number, maximum: number): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}
