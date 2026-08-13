import { describe, expect, it } from 'vitest';
import fixtureSummary from '@/data/backtest-summary.json';
import { assertProductionBacktestSummary } from '@/lib/backtest-summary';

describe('production backtest summary gate', () => {
  it('rejects the checked-in deterministic fixture and stale report', () => {
    expect(() => assertProductionBacktestSummary(fixtureSummary, Date.parse('2026-08-12T00:00:00.000Z'))).toThrow(/fixture|stale/i);
  });

  it('accepts complete public-data coverage with non-mechanical rows', () => {
    const generatedAt = '2026-08-12T00:00:00.000Z';
    const start = '2025-08-12T00:00:00.000Z';
    const end = '2026-08-11T20:00:00.000Z';
    const reports = ['BTC', 'ETH', 'SHIB', 'FIL', 'STX', 'DOGE', 'ARB', 'XRP'].flatMap((asset, index) => [
      { asset, interval: '4h', dataStart: start, dataEnd: end, candleCount: 2190, evaluatedSignals: index + 1, excludedSignals: 1 },
      { asset, interval: '1d', dataStart: '2024-08-12T00:00:00.000Z', dataEnd: '2026-08-11T00:00:00.000Z', candleCount: 730, evaluatedSignals: index + 2, excludedSignals: 2 },
    ]);

    expect(() =>
      assertProductionBacktestSummary(
        { generatedAt, source: 'Binance public no-key + Alternative.me public no-key', rows: [{ asset: 'BTC', interval: '4h', signalType: 'strong-buy', signalCount: 2 }], reports },
        Date.parse('2026-08-12T12:00:00.000Z'),
      ),
    ).not.toThrow();
  });

  it('rejects claimed coverage without fetched candles', () => {
    expect(() =>
      assertProductionBacktestSummary(
        {
          generatedAt: '2026-08-12T00:00:00.000Z',
          source: 'Binance public no-key',
          rows: [],
          reports: Array.from({ length: 8 }, (_, index) => {
            const asset = ['BTC', 'ETH', 'SHIB', 'FIL', 'STX', 'DOGE', 'ARB', 'XRP'][index];
            return [
              { asset, interval: '4h', dataStart: '2025-08-12T00:00:00.000Z', dataEnd: '2026-08-11T20:00:00.000Z', candleCount: 0 },
              { asset, interval: '1d', dataStart: '2024-08-12T00:00:00.000Z', dataEnd: '2026-08-11T00:00:00.000Z', candleCount: 0 },
            ];
          }).flat(),
        },
        Date.parse('2026-08-12T12:00:00.000Z'),
      ),
    ).toThrow(/candle/i);
  });
});
