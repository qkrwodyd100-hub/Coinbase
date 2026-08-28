import { describe, expect, it } from 'vitest';
import { evaluateAssetSnapshot, type DurableAlertState } from '@/lib/alert-outbox';
import type { AssetSignal } from '@/lib/signals';

const previousState: DurableAlertState = {
  previousScore: 79,
  signalBarClose: '2026-08-04T00:00:00.000Z',
  coverageRegime: 'full',
  extremeEligible: true,
  lastSentAt: {},
};

const crossingAsset: AssetSignal = {
  symbol: 'BTC',
  name: '비트코인',
  price: 65_000,
  overallScore: 80,
  signal: { label: '강력 매수', tone: 'positive' },
  stale: false,
  indicators: [],
  missingFeatures: [],
  scorePolicy: 'available indicator weights are normalized to 100',
  signalTimeframe: '1d',
  signalBarOpen: '2026-08-04T00:00:00.000Z',
  signalBarClose: '2026-08-05T00:00:00.000Z',
  availableWeight: 100,
  coverageRegime: 'full',
  extremeEligible: true,
  extremeCoverageFloor: 100,
  features: [
    {
      id: 'price',
      source: 'Binance spot BTCUSDT',
      timeframe: '1d',
      observedAt: '2026-08-04T00:00:00.000Z',
      availableAt: '2026-08-05T00:00:00.000Z',
      maxAgeMs: 300_000,
      status: 'available',
    },
  ],
};

describe('durable alert snapshot evaluation', () => {
  it('creates an immutable keyed event without advancing lastSentAt before acknowledgement', () => {
    const result = evaluateAssetSnapshot({
      asset: crossingAsset,
      previousState,
      now: Date.parse('2026-08-05T00:01:00.000Z'),
      hasPendingForType: false,
    });

    expect(result.event).toMatchObject({
      key: 'BTC:strong-buy:2026-08-05T00:00:00.000Z',
      assetSymbol: 'BTC',
      type: 'strong-buy',
      previousScore: 79,
      score: 80,
      signalBarClose: '2026-08-05T00:00:00.000Z',
      signalTimeframe: '1d',
    });
    expect(result.event?.message).toContain('BTC');
    expect(result.event?.message).toContain('79 → 80');
    expect(result.event?.message).toContain('1d');
    expect(result.event?.message).toContain('feature freshness/coverage: full');
    expect(result.event?.message).toContain('stale 0 · missing 0');
    expect(result.event?.message).toContain('100/100');
    expect(result.event?.message).toContain('투자 조언이나 거래 실행이 아닙니다');
    expect(result.event?.message).toContain('80 아래');
    expect(result.nextState.lastSentAt).toEqual({});
  });

  it('keeps the opposite type independent and creates the exact strong-sell crossing', () => {
    const now = Date.parse('2026-08-05T00:01:00.000Z');
    const result = evaluateAssetSnapshot({
      asset: { ...crossingAsset, overallScore: 20, signal: { label: '강력 매도', tone: 'negative' } },
      previousState: { ...previousState, previousScore: 21, lastSentAt: { 'strong-buy': now } },
      now,
      hasPendingForType: false,
    });

    expect(result.event).toMatchObject({ type: 'strong-sell', previousScore: 21, score: 20 });
    expect(result.event?.message).toContain('21 → 20');
    expect(result.event?.message).toContain('20 위');
    expect(result.nextState.lastSentAt).toEqual({ 'strong-buy': now });
  });
});
