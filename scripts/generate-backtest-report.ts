import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildAssetSignal, type AssetSymbol, type MarketCandle } from '../src/lib/signals.ts';
import { closedCandleBoundary, runBacktest, summarizeBacktest, valueForUtcDate, type ScoredCandle } from '../src/lib/backtest.ts';

type Asset = AssetSymbol;
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
const ASSETS: Asset[] = ['BTC', 'ETH', 'SHIB', 'FIL', 'STX', 'DOGE', 'ARB', 'XRP'];
const ASSET_NAME: Record<Asset, string> = { BTC: '비트코인', ETH: '이더리움', SHIB: '시바이누', FIL: '파일코인', STX: '스택스', DOGE: '도지코인', ARB: '아비트럼', XRP: '엑스알피' };

const mode = process.argv.includes('--fixture') ? 'fixture' : 'public';
const smoke = process.argv.includes('--smoke');

const results = mode === 'fixture' ? await fixtureResults() : await publicResults(smoke);
const summary = summarizeBacktest(results);
const payload = {
  ...summary,
  generatedAt: new Date().toISOString(),
  dataLimitations:
    mode === 'public'
      ? [
          ...summary.dataLimitations,
          'Historical open interest is unavailable in the public no-key backtest path, so futures positioning uses funding only (10 available points) and the available indicator weights are normalized to 100.',
        ]
      : summary.dataLimitations,
  source: mode === 'fixture' ? 'deterministic fixture' : 'Binance public no-key + Alternative.me public no-key',
  reports: results.map((result) => ({
    asset: result.asset,
    interval: result.interval,
    dataStart: result.dataStart ? new Date(result.dataStart).toISOString() : null,
    dataEnd: result.dataEnd ? new Date(result.dataEnd).toISOString() : null,
    signalCount: result.signals.length,
    excludedSignals: result.excludedSignals,
    horizon: result.interval === '4h' ? '24h' : '7d',
    lookAheadRule: result.lookAheadRule,
  })),
};

await writeJson(OUTPUT_JSON, payload);
await writeMarkdown(OUTPUT_MD, payload);
console.log(JSON.stringify({ outputJson: OUTPUT_JSON, outputMarkdown: OUTPUT_MD, rows: payload.rows.length, source: payload.source }, null, 2));

async function publicResults(smokeOnly: boolean) {
  const now = Date.now();
  const intervals: Interval[] = smokeOnly ? ['4h'] : ['4h', '1d'];
  const assets: Asset[] = smokeOnly ? ['BTC', 'ETH', 'SHIB', 'FIL', 'STX', 'DOGE', 'ARB', 'XRP'] : ASSETS;
  const fng = await fetchFearGreed();
  const allResults = [];

  for (const interval of intervals) {
    const end = closedCandleBoundary(now, interval);
    const start = end - LOOKBACKS[interval] * 24 * 60 * 60 * 1000;
    const ethBtc = await fetchKlines('ETHBTC', interval, start, end);
    for (const asset of assets) {
      const symbol = `${asset}USDT`;
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
  return ASSETS.flatMap((asset) => (['4h', '1d'] as const).map((interval) => runBacktest({ asset, interval, horizonMs: HORIZONS[interval], scoredCandles })));
}

function scoreCandles(asset: Asset, candles: MarketCandle[], fng: FearGreedRow[], funding: FundingRow[], ethBtc: MarketCandle[]): ScoredCandle[] {
  const scored: ScoredCandle[] = [];
  for (let index = 50; index < candles.length; index += 1) {
    const history = candles.slice(0, index + 1);
    const candle = candles[index];
    const fngValue = valueForUtcDate(fng, candle.openTime);
    const fundingValue = fundingForTime(funding, candle.openTime);
    const ethHistory = ethBtc.filter((item) => item.openTime <= candle.openTime);
    const ethBtcCurrent = ethHistory.at(-1)?.close;
    const ethBtcMa20 = ethHistory.length >= 20 ? average(ethHistory.slice(-20).map((item) => item.close)) : undefined;
    const previousClose = candles[index - 1]?.close ?? candle.open;
    const signal = buildAssetSignal({
      symbol: asset,
      name: ASSET_NAME[asset],
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

function fundingForTime(rows: FundingRow[], time: number): number | undefined {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rows[index].fundingTime <= time) return rows[index].fundingRatePercent;
  }
  return undefined;
}


function writeJson(path: string, value: unknown) {
  return writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeMarkdown(path: string, payload: typeof summary & { source: string; reports: Array<Record<string, unknown>> }) {
  const rows = payload.rows.map((row) => `| ${row.asset} | ${row.interval} | ${row.signalType} | ${row.signalCount} | ${row.hitCount} | ${row.hitRatePercent}% | ${row.averageCloseReturnPercent}% |`).join('\n');
  const coverage = payload.reports
    .map(
      (report) =>
        `| ${report.asset} | ${report.interval} | ${report.horizon} | ${report.dataStart ?? 'n/a'} | ${report.dataEnd ?? 'n/a'} | ${report.signalCount} | ${report.excludedSignals} |`,
    )
    .join('\n');
  return writeText(
    path,
    `# Crypto signal backtest report\n\nGenerated: ${payload.generatedAt}\nSource: ${payload.source}\n\n## Methodology\n\n- Score weights with complete inputs: moving averages 25 + RSI 20 + MFI 20 + funding/open interest 20 + Fear & Greed 15 = 100.\n- ETH additionally blends the normalized base score at 95% with ETH/BTC 20-candle relative strength at 5%.\n- Missing indicators receive neither zero nor full credit; available weights are normalized to 100 and disclosed below.\n- Look-ahead rule: calculate the score after candle close, enter at the next candle open, evaluate only complete 24h (4h bars) or 7d (1d bars) horizons, and exclude the candle starting at the horizon boundary.\n- Hit rule: strong-buy succeeds on a +3% intrahorizon high; strong-sell succeeds on a -3% intrahorizon low.\n\n| Asset | Interval | Signal | Count | Hits | Hit rate | Avg close return |\n| --- | --- | --- | ---: | ---: | ---: | ---: |\n${rows}\n\n## Coverage\n\n| Asset | Interval | Horizon | Data start | Data end | Evaluated signals | Excluded signals |\n| --- | --- | --- | --- | --- | ---: | ---: |\n${coverage}\n\n## Data limitations\n\n${payload.dataLimitations.map((item) => `- ${item}`).join('\n')}\n`,
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


function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}