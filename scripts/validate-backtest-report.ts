import summary from '../src/data/backtest-summary.json' with { type: 'json' };
import { assertProductionBacktestSummary } from '../src/lib/backtest-summary.ts';

assertProductionBacktestSummary(summary);
console.log(JSON.stringify({
  generatedAt: summary.generatedAt,
  source: summary.source,
  reports: summary.reports.length,
}));
