import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildAssetSignal, type MarketCandle } from '../src/lib/signals.ts';
import { runBacktest, summarizeBacktest, type ScoredCandle } from '../src/lib/backtest.ts';

type Asset = 'BTC' | 'ETH';
type Interval = '4h' | '1d';

type FundingRow = {
  fundingTime: number;
  fundingRatePercent: number;
};

type FearGreedRow = {
  date: string;
  value: number;
};

const DATA_API = 'https://data-api.binance.vision/api/v3/klines';
const FUNDING_API = 'https://fapi.binance.com/fapi/v1/fundingRate';
const FNG_API = 'https://api.alternative.me/fng/?limit=0&format=json';
const OUTPUT_JSON = resolve('src/data/backtest-summary.json');
const OUTPUT_MD = resolve('reports/backtest-report.md');
const LOOKBACKS: Record<Interval, number> = { '4h': 365, '1d': 730 };
const HORIZONS: Record<Interval, number> = { '4h': 24 * 60 * 60 * 1000, '1d': 7 * 24 * 60 * 60 * 1000 };

const mode = process.argv.includes('--fixture') ? 'fixture' : 'public';
const smoke = process.argv.includes('--smoke');

const results = mode === 'fixture' ? await fixtureResults() : await publicResults(smoke);
const summary = summarizeBacktest(results);
const payload = {
  ...summary,
  generatedAt: new Date().toISOString(),
  source: mode === 'fixture' ? 'deterministic fixture' : 'Binance public no-key + Alternative.me public no-key',
  reports: results.map((result) => ({
    asset: result.asset,
    interval: result.interval,
    dataStart: result.dataStart ? new Date(result.dataStart).toISOString() : null,
    dataEnd: result.dataEnd ? new Date(result.dataEnd).toISOString() : null,
    signalCount: result.signals.length,
    excludedSignals: result.excludedSignals,
    lookAheadRule: result.lookAheadRule,
  })),
};

await writeJson(OUTPUT_JSON, payload);
await writeMarkdown(OUTPUT_MD, payload);
console.log(JSON.stringify({ outputJson: OUTPUT_JSON, outputMarkdown: OUTPUT_MD, rows: payload.rows.length, source: payload.source }, null, 2));

async function publicResults(smokeOnly: boolean) {
  const end = floorToClosedInterval(Date.now(), 4 * 60 * 60 * 1000);
  const intervals: Interval[] = smokeOnly ? ['4h'] : ['4h', '1d'];
  const assets: Asset[] = smokeOnly ? ['BTC'] : ['BTC', 'ETH'];
  const fng = await fetchFearGreed();
  const allResults = [];

  for (const interval of intervals) {
    const start = end - LOOKBACKS[interval] * 24 * 60 * 60 * 1000;
    const ethBtc = await fetchKlines('ETHBTC', interval, start, end);
    for (const asset of assets) {
      const symbol = asset === 'BTC' ? 'BTCUSDT' : 'ETHUSDT';
      const candles = await fetchKlines(symbol, interval, start, end);
      const funding = await fetchFunding(symbol, start, end);
      const scoredCandles = scoreCandles(asset, candles, fng, funding, ethBtc);
      allResults.push(runBacktest({ asset, interval, horizonMs: HORIZONS[interval], scoredCandles }));
    }
  }

  return allResults;
}

async function fixtureResults() {
  const candles = Array.from({ length: 90 }, (_, index) => ({
    openTime: 1_700_000_000_000 + index * 4 * 60 * 60 * 1000,
    open: 100 + index * 0.1,
    high: 102 + index * 0.15,
    low: 98 + index * 0.05,
    close: 100 + Math.sin(index / 4) * 8 + index * 0.08,
    volume: 1000 + index * 10,
  }));
  const scoredCandles = candles.map((candle, index) => ({ candle, score: index === 20 ? 82 : index === 50 ? 18 : 45 }));
  return [runBacktest({ asset: 'BTC', interval: '4h', horizonMs: HORIZONS['4h'], scoredCandles })];
}

function scoreCandles(asset: Asset, candles: MarketCandle[], fng: FearGreedRow[], funding: FundingRow[], ethBtc: MarketCandle[]): ScoredCandle[] {
  const scored: ScoredCandle[] = [];
  for (let index = 50; index < candles.length; index += 1) {
    const history = candles.slice(0, index + 1);
    const candle = candles[index];
    const fngValue = fearGreedForTime(fng, candle.openTime);
    const fundingValue = fundingForTime(funding, candle.openTime);
    const ethHistory = ethBtc.filter((item) => item.openTime <= candle.openTime);
    const ethBtcCurrent = ethHistory.at(-1)?.close;
    const ethBtcMa20 = ethHistory.length >= 20 ? average(ethHistory.slice(-20).map((item) => item.close)) : undefined;
    const previousClose = candles[index - 1]?.close ?? candle.open;
    const signal = buildAssetSignal({
      symbol: asset,
      name: asset === 'BTC' ? '비트코인' : '이더리움',
      price: candle.close,
      candles: history,
      fearGreed: fngValue,
      fundingPercent: fundingValue,
      priceChangePercent: ((candle.close - previousClose) / previousClose) * 100,
      ethBtcCurrent: asset === 'ETH' ? ethBtcCurrent : undefined,
      ethBtcMa20: asset === 'ETH' ? ethBtcMa20 : undefined,
    });
    scored.push({ candle, score: signal.overallScore });
  }
  return scored;
}

async function fetchKlines(symbol: string, interval: Interval, startTime: number, endTime: number): Promise<MarketCandle[]> {
  const rows: MarketCandle[] = [];
  let cursor = startTime;
  while (cursor < endTime) {
    const url = `${DATA_API}?symbol=${symbol}&interval=${interval}&startTime=${cursor}&endTime=${endTime}&limit=1000`;
    const payload = await fetchJson(url);
    if (!Array.isArray(payload) || payload.length === 0) break;
    const batch = payload.map((row, index) => parseKline(row, `${symbol}[${index}]`));
    rows.push(...batch);
    const next = (batch.at(-1)?.openTime ?? cursor) + intervalMs(interval);
    if (next <= cursor) break;
    cursor = next;
    if (smoke) break;
  }
  return rows.filter((row) => row.openTime < endTime);
}

async function fetchFunding(symbol: string, startTime: number, endTime: number): Promise<FundingRow[]> {
  const rows: FundingRow[] = [];
  let cursor = startTime;
  while (cursor < endTime) {
    const payload = await fetchJson(`${FUNDING_API}?symbol=${symbol}&startTime=${cursor}&endTime=${endTime}&limit=1000`);
    if (!Array.isArray(payload) || payload.length === 0) break;
    for (const row of payload) {
      if (!isRecord(row)) continue;
      rows.push({ fundingTime: parseNumber(row.fundingTime, `${symbol} fundingTime`), fundingRatePercent: parseNumber(row.fundingRate, `${symbol} fundingRate`) * 100 });
    }
    const next = (rows.at(-1)?.fundingTime ?? cursor) + 1;
    if (next <= cursor) break;
    cursor = next;
    if (smoke) break;
  }
  return rows;
}

async function fetchFearGreed(): Promise<FearGreedRow[]> {
  const payload = await fetchJson(FNG_API);
  if (!isRecord(payload) || !Array.isArray(payload.data)) return [];
  return payload.data
    .filter(isRecord)
    .map((row) => ({ date: utcDate(parseNumber(row.timestamp, 'FNG timestamp') * 1000), value: parseNumber(row.value, 'FNG value') }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Request failed ${response.status} for ${url}`);
  return response.json();
}

function parseKline(row: unknown, label: string): MarketCandle {
  if (!Array.isArray(row) || row.length < 6) throw new Error(`Unexpected kline row for ${label}`);
  return {
    openTime: normalizeTimestamp(parseNumber(row[0], `${label} openTime`)),
    open: parsePositive(row[1], `${label} open`),
    high: parsePositive(row[2], `${label} high`),
    low: parsePositive(row[3], `${label} low`),
    close: parsePositive(row[4], `${label} close`),
    volume: parsePositive(row[5], `${label} volume`),
  };
}

function fundingForTime(rows: FundingRow[], time: number): number {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rows[index].fundingTime <= time) return rows[index].fundingRatePercent;
  }
  return 0;
}

function fearGreedForTime(rows: FearGreedRow[], time: number): number {
  const date = utcDate(time);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rows[index].date <= date) return rows[index].value;
  }
  return 50;
}

function writeJson(path: string, value: unknown) {
  return writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeMarkdown(path: string, payload: typeof summary & { source: string; reports: Array<Record<string, unknown>> }) {
  const rows = payload.rows.map((row) => `| ${row.asset} | ${row.interval} | ${row.signalType} | ${row.signalCount} | ${row.hitCount} | ${row.hitRatePercent}% | ${row.averageCloseReturnPercent}% |`).join('\n');
  return writeText(
    path,
    `# Crypto signal backtest report\n\nGenerated: ${payload.generatedAt}\nSource: ${payload.source}\n\nLook-ahead rule: score after candle close, enter at next observable candle open.\n\n| Asset | Interval | Signal | Count | Hits | Hit rate | Avg close return |\n| --- | --- | --- | ---: | ---: | ---: | ---: |\n${rows}\n\n## Data limitations\n\n${payload.dataLimitations.map((item) => `- ${item}`).join('\n')}\n`,
  );
}

async function writeText(path: string, text: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, 'utf8');
}

function parsePositive(value: unknown, label: string): number {
  const parsed = parseNumber(value, label);
  if (parsed <= 0) throw new Error(`${label} must be greater than zero.`);
  return parsed;
}

function parseNumber(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) throw new Error(`${label} is not finite.`);
  return parsed;
}

function normalizeTimestamp(value: number): number {
  return value > 1e15 ? Math.trunc(value / 1000) : value;
}

function utcDate(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

function intervalMs(interval: Interval): number {
  return interval === '4h' ? 4 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
}

function floorToClosedInterval(time: number, size: number): number {
  return Math.floor(time / size) * size - size;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
