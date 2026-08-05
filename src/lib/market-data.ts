import { buildAssetSignal, type AssetSignal, type DashboardPayload } from './signals';

type AssetConfig = {
  symbol: 'BTC' | 'ETH';
  name: string;
  spotSymbol: 'BTCUSDT' | 'ETHUSDT';
};

const ASSETS: AssetConfig[] = [
  { symbol: 'BTC', name: 'Bitcoin', spotSymbol: 'BTCUSDT' },
  { symbol: 'ETH', name: 'Ethereum', spotSymbol: 'ETHUSDT' },
];

const BINANCE_BASE = 'https://api.binance.com';
const BINANCE_FUTURES_BASE = 'https://fapi.binance.com';
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
    getTickerPrice(asset.spotSymbol),
    getDailyCloses(asset.spotSymbol),
    getFundingPercent(asset.spotSymbol),
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
  const payload = await fetchJson(`${BINANCE_BASE}/api/v3/ticker/price?symbol=${symbol}`);
  if (!isRecord(payload) || typeof payload.price !== 'string') {
    throw new Error(`Unexpected ticker payload for ${symbol}`);
  }

  return parseFiniteNumber(payload.price, `${symbol} price`);
}

async function getDailyCloses(symbol: string): Promise<number[]> {
  const payload = await fetchJson(`${BINANCE_BASE}/api/v3/klines?symbol=${symbol}&interval=1d&limit=80`);
  if (!Array.isArray(payload)) {
    throw new Error(`Unexpected kline payload for ${symbol}`);
  }

  const closes = payload.map((entry, index) => {
    if (!Array.isArray(entry) || typeof entry[4] !== 'string') {
      throw new Error(`Unexpected kline close at ${symbol}[${index}]`);
    }
    return parseFiniteNumber(entry[4], `${symbol} close`);
  });

  if (closes.length < 51) {
    throw new Error(`Not enough ${symbol} closes to calculate signals.`);
  }

  return closes;
}

async function getFundingPercent(symbol: string): Promise<number> {
  const payload = await fetchJson(`${BINANCE_FUTURES_BASE}/fapi/v1/premiumIndex?symbol=${symbol}`);
  if (!isRecord(payload) || typeof payload.lastFundingRate !== 'string') {
    throw new Error(`Unexpected funding payload for ${symbol}`);
  }

  return parseFiniteNumber(payload.lastFundingRate, `${symbol} funding`) * 100;
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

  return parseFiniteNumber(latest.value, 'Fear & Greed');
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

function parseFiniteNumber(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} is not a finite number.`);
  }
  return parsed;
}
