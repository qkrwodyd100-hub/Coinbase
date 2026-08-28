import { describe, expect, it } from 'vitest';
import {
  HOLDINGS_POLICY_VERSION,
  evaluateHolding,
  exportHoldingsCsv,
  exportHoldingsJson,
  importHoldingsCsv,
  importHoldingsJson,
  parseHoldingsStorage,
  validateHoldingDraft,
  type Holding,
  type HoldingMarketSnapshot,
} from '@/lib/holdings';

const holding: Holding = {
  id: 'local-1',
  symbol: 'BTC',
  averageBuyPriceKrw: 70_000_000,
  quantity: 0.1,
  investedPrincipalKrw: null,
  firstBuyDate: '2025-01-10',
  recentBuyDate: '2026-01-10',
  targetDeadline: '2028-12-31',
  memo: '장기 관찰',
  lossSalePreference: true,
};

const market: HoldingMarketSnapshot = {
  currentPriceKrw: 91_250_000,
  asOf: '2026-08-28T00:00:00.000Z',
  signalBarClose: '2026-08-28T00:00:00.000Z',
  signalTimeframe: '1d',
  score: 85,
  signalLabel: '강력 매수',
  extremeEligible: true,
  coverageRegime: 'full',
  availableWeight: 100,
  extremeCoverageFloor: 100,
  stale: false,
  trendConfirmed: true,
  trendBroken: false,
  sellThresholdCrossed: false,
  backtest: { sampleCount: 24, evaluated: 21, excluded: 3, outOfSampleValidated: false },
};

describe('holdings validation and storage', () => {
  it('accepts quantity or principal but rejects missing valuation inputs', () => {
    expect(validateHoldingDraft({ ...holding, id: undefined })).toMatchObject({ ok: true });
    expect(validateHoldingDraft({ ...holding, id: undefined, quantity: null, investedPrincipalKrw: 7_000_000 })).toMatchObject({ ok: true });
    expect(validateHoldingDraft({ ...holding, id: undefined, quantity: null, investedPrincipalKrw: null })).toMatchObject({ ok: false });
  });

  it.each([NaN, -1, Number.POSITIVE_INFINITY, 1_000_000_000_000_001])('rejects unsafe average prices: %s', (averageBuyPriceKrw) => {
    expect(validateHoldingDraft({ ...holding, id: undefined, averageBuyPriceKrw })).toMatchObject({ ok: false });
  });

  it('rejects unsupported symbols, reversed dates, and inconsistent quantity/principal', () => {
    expect(validateHoldingDraft({ ...holding, id: undefined, symbol: 'SOL' as 'BTC' })).toMatchObject({ ok: false });
    expect(validateHoldingDraft({ ...holding, id: undefined, firstBuyDate: '2026-02-01', recentBuyDate: '2026-01-01' })).toMatchObject({ ok: false });
    const result = validateHoldingDraft({ ...holding, id: undefined, investedPrincipalKrw: 1_000_000 });
    expect(result).toMatchObject({ ok: true });
    expect(result.warnings).toContain('수량 기준 원금과 입력한 총투자원금이 5% 이상 다릅니다.');
    expect(validateHoldingDraft({ ...holding, id: undefined, firstBuyDate: '2026-02-31' })).toMatchObject({ ok: false });
  });

  it('migrates version 1 storage, removes invalid rows, and recovers corrupt storage', () => {
    const migrated = parseHoldingsStorage(JSON.stringify({ version: 1, holdings: [{ ...holding, lossSalePreference: undefined }] }));
    expect(migrated).toHaveLength(1);
    expect(migrated[0].lossSalePreference).toBe(false);
    expect(parseHoldingsStorage('{bad json')).toEqual([]);
    expect(parseHoldingsStorage(JSON.stringify({ version: 2, holdings: [{ ...holding, averageBuyPriceKrw: -1 }] }))).toEqual([]);
    const duplicateIds = parseHoldingsStorage(JSON.stringify({ version: 2, holdings: [holding, { ...holding, symbol: 'ETH' }] }));
    expect(new Set(duplicateIds.map((row) => row.id)).size).toBe(2);
  });
});

describe('holdings CSV security', () => {
  it('round-trips only holding fields without application secrets', () => {
    const csv = exportHoldingsCsv([holding]);
    expect(csv).toContain('symbol,averageBuyPriceKrw,quantity');
    expect(csv).not.toMatch(/token|secret|api[_-]?key|environment/i);
    expect(importHoldingsCsv(csv)).toEqual([{ ...holding, id: 'import-1' }]);
    const json = exportHoldingsJson([holding]);
    expect(json).not.toMatch(/token|secret|api[_-]?key|environment/i);
    expect(importHoldingsJson(json)).toEqual([{ ...holding, id: 'import-1' }]);
  });

  it.each(['=1+1', '+cmd', '-2+3', '@SUM(A1:A2)'])('rejects formula injection cells: %s', (memo) => {
    const csv = `symbol,averageBuyPriceKrw,quantity,investedPrincipalKrw,firstBuyDate,recentBuyDate,targetDeadline,memo,lossSalePreference\nBTC,70000000,0.1,,,,,${memo},false`;
    expect(() => importHoldingsCsv(csv)).toThrow(/수식|formula/i);
  });

  it('rejects oversized, malformed, negative, and unsupported-asset imports', () => {
    expect(() => importHoldingsCsv('x'.repeat(300_000))).toThrow(/크기/);
    expect(() => importHoldingsCsv('symbol,averageBuyPriceKrw\nBTC,"unterminated')).toThrow(/CSV/);
    expect(() => importHoldingsCsv('symbol,averageBuyPriceKrw,quantity,investedPrincipalKrw,firstBuyDate,recentBuyDate,targetDeadline,memo,lossSalePreference\nBTC,-1,1,,,,,,false')).toThrow(/유효|formula/);
    expect(() => importHoldingsCsv('symbol,averageBuyPriceKrw,quantity,investedPrincipalKrw,firstBuyDate,recentBuyDate,targetDeadline,memo,lossSalePreference\nSOL,1000,1,,,,,,false')).toThrow(/유효/);
    expect(() => importHoldingsCsv('symbol,averageBuyPriceKrw,quantity,investedPrincipalKrw,firstBuyDate,recentBuyDate,targetDeadline,memo,lossSalePreference\nBTC,1000,1,,,,,,maybe')).toThrow(/true 또는 false/);
    expect(() => importHoldingsCsv('symbol,averageBuyPriceKrw,quantity,investedPrincipalKrw,firstBuyDate,recentBuyDate,targetDeadline,memo,lossSalePreference\nBTC,1000,1,,,,,"memo"junk,false')).toThrow(/따옴표/);
  });
});

describe('deterministic personalized reference policy', () => {
  it('is versioned and deterministic for the same snapshot', () => {
    expect(HOLDINGS_POLICY_VERSION).toMatch(/^holdings-v\d+$/);
    expect(evaluateHolding({ holding, market, portfolioValueKrw: 9_125_000, additionalBudgetKrw: 1_000_000, now: '2026-08-28T00:00:00.000Z' })).toEqual(
      evaluateHolding({ holding, market, portfolioValueKrw: 9_125_000, additionalBudgetKrw: 1_000_000, now: '2026-08-28T00:00:00.000Z' }),
    );
  });

  it.each([
    ['stale snapshot', { stale: true }],
    ['missing closed bar', { signalBarClose: '' }],
    ['limited coverage', { coverageRegime: 'limited' as const, availableWeight: 85, extremeEligible: false }],
    ['missing price', { currentPriceKrw: null }],
  ])('fails closed as data insufficient for %s', (_label, patch) => {
    const result = evaluateHolding({ holding, market: { ...market, ...patch }, portfolioValueKrw: 9_125_000, additionalBudgetKrw: 1_000_000, now: '2026-08-28T00:00:00.000Z' });
    expect(result.status).toBe('데이터 부족');
    expect(result.invalidationConditions.length).toBeGreaterThan(0);
  });

  it('does not average down from loss alone or buy from a high score without trend and budget confirmation', () => {
    const lossMarket = { ...market, currentPriceKrw: 60_000_000, score: 50, signalLabel: '관망' as const, extremeEligible: false };
    expect(evaluateHolding({ holding, market: lossMarket, portfolioValueKrw: 6_000_000, additionalBudgetKrw: 1_000_000, now: '2026-08-28T00:00:00.000Z' }).status).not.toBe('추가매수 검토');
    expect(evaluateHolding({ holding, market: { ...market, trendConfirmed: false }, portfolioValueKrw: 9_125_000, additionalBudgetKrw: 1_000_000, now: '2026-08-28T00:00:00.000Z' }).status).not.toBe('추가매수 검토');
    expect(evaluateHolding({ holding, market, portfolioValueKrw: 18_250_000, additionalBudgetKrw: null, now: '2026-08-28T00:00:00.000Z' }).status).toBe('보유');
    expect(evaluateHolding({ holding, market, portfolioValueKrw: 18_250_000, additionalBudgetKrw: Number.POSITIVE_INFINITY, now: '2026-08-28T00:00:00.000Z' }).status).toBe('보유');
  });

  it('allows additional-buy review only with closed full-coverage strong score, trend, and positive budget', () => {
    const result = evaluateHolding({ holding, market, portfolioValueKrw: 18_250_000, additionalBudgetKrw: 1_000_000, now: '2026-08-28T00:00:00.000Z' });
    expect(result.status).toBe('추가매수 검토');
    expect(result.checklist).toContain('추가 투자 가능 금액을 별도로 확인했습니다.');
    expect(result).not.toHaveProperty('recommendedOrderAmount');
  });

  it('separates sell-score, trend-break, deadline, and concentration reasons while exposing loss-sale preference conflict', () => {
    const result = evaluateHolding({
      holding: { ...holding, targetDeadline: '2026-08-01' },
      market: { ...market, currentPriceKrw: 60_000_000, score: 15, signalLabel: '강력 매도', trendConfirmed: false, trendBroken: true, sellThresholdCrossed: true },
      portfolioValueKrw: 6_000_000,
      additionalBudgetKrw: 0,
      now: '2026-08-28T00:00:00.000Z',
    });
    expect(result.status).toBe('비중축소 검토');
    expect(result.reasons.join(' ')).toMatch(/시장 점수|추세|목표기한|집중/);
    expect(result.conflicts.join(' ')).toMatch(/손실 매도 회피/);
  });

  it('does not invent a sell threshold event from a low score that did not cross on the current closed bar', () => {
    const result = evaluateHolding({
      holding: { ...holding, targetDeadline: null },
      market: { ...market, currentPriceKrw: 60_000_000, score: 15, signalLabel: '강력 매도', trendConfirmed: false, trendBroken: false, sellThresholdCrossed: false },
      portfolioValueKrw: 12_000_000,
      additionalBudgetKrw: 0,
      now: '2026-08-28T00:00:00.000Z',
    });
    expect(result.status).toBe('보유');
    expect(result.reasons.join(' ')).not.toMatch(/하향 통과/);
  });

  it('calculates valuation, profit, return, and concentration only when quantity is present', () => {
    const result = evaluateHolding({ holding, market, portfolioValueKrw: 18_250_000, additionalBudgetKrw: 0, now: '2026-08-28T00:00:00.000Z' });
    expect(result.metrics).toMatchObject({ costBasisKrw: 7_000_000, marketValueKrw: 9_125_000, profitKrw: 2_125_000, returnPercent: 30.357142857142854, portfolioWeightPercent: 50 });
    const rateOnly = evaluateHolding({ holding: { ...holding, quantity: null, investedPrincipalKrw: 7_000_000 }, market, portfolioValueKrw: null, additionalBudgetKrw: 0, now: '2026-08-28T00:00:00.000Z' });
    expect(rateOnly.metrics.marketValueKrw).toBeNull();
    expect(rateOnly.metrics.returnPercent).toBeCloseTo(30.357, 3);
  });

  it('marks confidence low when sample is small or out-of-sample is unverified', () => {
    expect(evaluateHolding({ holding, market, portfolioValueKrw: 9_125_000, additionalBudgetKrw: 0, now: '2026-08-28T00:00:00.000Z' }).confidence).toBe('low');
  });
});
