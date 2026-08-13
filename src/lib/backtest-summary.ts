type SummaryRow = {
  asset?: string;
  interval?: string;
  signalType?: string;
  signalCount?: number;
};

type Report = {
  asset?: string;
  interval?: string;
  dataStart?: string | null;
  dataEnd?: string | null;
  candleCount?: number;
  evaluatedSignals?: number;
  excludedSignals?: number;
};

type BacktestSummaryForValidation = {
  generatedAt?: string;
  source?: string;
  rows?: SummaryRow[];
  reports?: Report[];
};

const ASSETS = ['BTC', 'ETH', 'SHIB', 'FIL', 'STX', 'DOGE', 'ARB', 'XRP'];
const MAX_AGE_MS = 36 * 60 * 60 * 1000;
const FOUR_HOUR_TARGET_MS = 365 * 24 * 60 * 60 * 1000;
const DAILY_TARGET_MS = 730 * 24 * 60 * 60 * 1000;

export function assertProductionBacktestSummary(summary: BacktestSummaryForValidation, now = Date.now()): void {
  if (!summary.source || /fixture/i.test(summary.source)) throw new Error('Production backtest summary must not use a fixture source.');
  const generatedAt = Date.parse(summary.generatedAt ?? '');
  if (!Number.isFinite(generatedAt) || now - generatedAt > MAX_AGE_MS || generatedAt > now + 5 * 60 * 1000) {
    throw new Error('Production backtest summary is stale or has an invalid generatedAt timestamp.');
  }

  const reports = summary.reports ?? [];
  for (const asset of ASSETS) {
    assertCoverage(reports.find((report) => report.asset === asset && report.interval === '4h'), FOUR_HOUR_TARGET_MS, `${asset} 4h`);
    assertCoverage(reports.find((report) => report.asset === asset && report.interval === '1d'), DAILY_TARGET_MS, `${asset} 1d`);
  }

  const rows = summary.rows ?? [];
  const fingerprints = new Set(rows.map((row) => JSON.stringify([row.interval, row.signalType, row.signalCount])));
  if (rows.length >= ASSETS.length * 2 && fingerprints.size <= 2) {
    throw new Error('Production backtest rows are mechanically identical across assets.');
  }
}

function assertCoverage(report: Report | undefined, targetMs: number, label: string): void {
  const start = Date.parse(report?.dataStart ?? '');
  const end = Date.parse(report?.dataEnd ?? '');
  const expectedCandles = targetMs / (label.endsWith('4h') ? 4 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000);
  if (!report || !Number.isFinite(start) || !Number.isFinite(end) || end - start < targetMs * 0.98 || (report.candleCount ?? 0) < expectedCandles * 0.98) {
    throw new Error(`${label} report does not have complete historical candle coverage.`);
  }
}
