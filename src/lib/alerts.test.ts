import { describe, expect, it } from 'vitest';
import type { AssetSignal, AssetSymbol, CoverageRegime } from '@/lib/signals';
import {
  ALERT_COOLDOWN_MS,
  buildExtremeSignalAlertMessage,
  evaluateExtremeSignalAlerts,
  parseStoredAlertState,
  serializeAlertState,
  type ExtremeSignalAlertState,
} from '@/lib/alerts';

const baseIndicators: AssetSignal['indicators'] = [
  { id: 'moving-averages', title: '이동평균', value: '$65,000 / MA20 $63,000 / MA50 $61,000', score: 25, maxScore: 25, interpretation: 'MA20이 MA50 위에 있고 현재가의 MA20 이격이 5% 이내라 건강한 상승 정렬로 봅니다.' },
  { id: 'rsi', title: 'RSI (14)', value: '28.00', score: 20, maxScore: 20, interpretation: 'RSI 30 이하는 과매도 구간으로 최대 점수를 부여합니다.' },
  { id: 'mfi', title: '자금 흐름 MFI (14)', value: '18.00', score: 20, maxScore: 20, interpretation: 'MFI 20 이하는 거래량이 동반된 과매도 구간으로 봅니다.' },
  { id: 'futures-positioning', title: '선물 펀딩비·미체결약정', value: '-0.0010% / OI 2.00%', score: 20, maxScore: 20, interpretation: '음수 또는 중립 펀딩은 과열된 롱 레버리지를 피하므로 높은 점수를 줍니다. 가격 상승과 OI 증가가 함께 나타나 추세 참여가 확인됩니다.' },
  { id: 'fear-greed', title: '공포·탐욕 지수', value: '22', score: 15, maxScore: 15, interpretation: '극단적 공포 구간은 역발상 가산점을 최대로 반영합니다.' },
];

function asset(symbol: AssetSymbol, score: number, indicators = baseIndicators, coverageRegime: CoverageRegime = 'full'): AssetSignal {
  return {
    symbol,
    name: symbol === 'BTC' ? '비트코인' : symbol === 'ETH' ? '이더리움' : '시바이누',
    price: symbol === 'BTC' ? 65_000 : symbol === 'ETH' ? 3_200 : 0.00001234,
    overallScore: score,
    signal: score >= 80 ? { label: '강력 매수', tone: 'positive' } : score <= 20 ? { label: '강력 매도', tone: 'negative' } : { label: '관망', tone: 'neutral' },
    stale: false,
    indicators,
    missingFeatures: [],
    scorePolicy: 'available indicator weights are normalized to 100',
    signalTimeframe: '1d',
    signalBarOpen: '2026-08-04T00:00:00.000Z',
    signalBarClose: '2026-08-05T00:00:00.000Z',
    availableWeight: coverageRegime === 'full' ? 100 : 80,
    coverageRegime,
    extremeEligible: coverageRegime === 'full',
    extremeCoverageFloor: 100,
    features: [],
  };
}

describe('extreme signal alert decisions', () => {
  it('fires a strong-buy alert only when an asset crosses from below 80 to at least 80', () => {
    const first = evaluateExtremeSignalAlerts({ assets: [asset('BTC', 79)], previousState: {}, now: 1_000 });
    expect(first.alerts).toEqual([]);

    const second = evaluateExtremeSignalAlerts({ assets: [asset('BTC', 80)], previousState: first.nextState, now: 61_000 });
    expect(second.alerts).toHaveLength(1);
    expect(second.alerts[0]).toMatchObject({ assetSymbol: 'BTC', type: 'strong-buy', score: 80 });

    const third = evaluateExtremeSignalAlerts({ assets: [asset('BTC', 86)], previousState: second.nextState, now: 121_000 });
    expect(third.alerts).toEqual([]);
  });

  it('fires a strong-sell alert only when an asset crosses from above 20 to 20 or lower', () => {
    const first = evaluateExtremeSignalAlerts({ assets: [asset('ETH', 21)], previousState: {}, now: 1_000 });
    const second = evaluateExtremeSignalAlerts({ assets: [asset('ETH', 20)], previousState: first.nextState, now: 61_000 });

    expect(second.alerts).toHaveLength(1);
    expect(second.alerts[0]).toMatchObject({ assetSymbol: 'ETH', type: 'strong-sell', score: 20 });
  });

  it('keeps BTC and ETH cooldowns independent per alert type for 6 hours', () => {
    const sentAt = 10_000;
    const previousState: ExtremeSignalAlertState = {
      BTC: { previousScore: 79, lastSentAt: { 'strong-buy': sentAt } },
      ETH: { previousScore: 79, lastSentAt: {} },
    };

    const result = evaluateExtremeSignalAlerts({ assets: [asset('BTC', 82), asset('ETH', 82)], previousState, now: sentAt + ALERT_COOLDOWN_MS - 1 });

    expect(result.alerts.map((alert) => alert.assetSymbol)).toEqual(['ETH']);
    expect(result.nextState.BTC!.previousScore).toBe(82);
    expect(result.nextState.ETH!.lastSentAt['strong-buy']).toBe(sentAt + ALERT_COOLDOWN_MS - 1);
  });

  it('requires a fresh re-entry after cooldown instead of repeating while the score stays extreme', () => {
    const afterFirst = evaluateExtremeSignalAlerts({ assets: [asset('BTC', 80)], previousState: { BTC: { previousScore: 79, lastSentAt: {} } }, now: 1_000 });
    const stillExtreme = evaluateExtremeSignalAlerts({ assets: [asset('BTC', 83)], previousState: afterFirst.nextState, now: 1_000 + ALERT_COOLDOWN_MS + 1 });
    const exited = evaluateExtremeSignalAlerts({ assets: [asset('BTC', 72)], previousState: stillExtreme.nextState, now: 1_000 + ALERT_COOLDOWN_MS + 61_000 });
    const reentered = evaluateExtremeSignalAlerts({ assets: [asset('BTC', 84)], previousState: exited.nextState, now: 1_000 + ALERT_COOLDOWN_MS + 121_000 });

    expect(stillExtreme.alerts).toEqual([]);
    expect(reentered.alerts).toHaveLength(1);
  });

  it('re-baselines without an event when a coverage transition alone changes the threshold class', () => {
    const baseline = evaluateExtremeSignalAlerts({ assets: [asset('BTC', 79)], previousState: {}, now: 1_000 });
    const limitedCrossing = evaluateExtremeSignalAlerts({ assets: [asset('BTC', 82, baseIndicators, 'limited')], previousState: baseline.nextState, now: 2_000 });
    const restoredCoverage = evaluateExtremeSignalAlerts({ assets: [asset('BTC', 82)], previousState: limitedCrossing.nextState, now: 3_000 });
    const exited = evaluateExtremeSignalAlerts({ assets: [asset('BTC', 79)], previousState: restoredCoverage.nextState, now: 4_000 });
    const marketCrossing = evaluateExtremeSignalAlerts({ assets: [asset('BTC', 80)], previousState: exited.nextState, now: 5_000 });

    expect(limitedCrossing.alerts).toEqual([]);
    expect(restoredCoverage.alerts).toEqual([]);
    expect(marketCrossing.alerts).toHaveLength(1);
  });

  it.each(['BTC', 'ETH'] as const)('validates %s strong-buy crossing, sustained zone silence, cooldown, and re-entry', (symbol) => {
    const baseline = evaluateExtremeSignalAlerts({ assets: [asset(symbol, 79)], previousState: {}, now: 1_000 });
    const crossed = evaluateExtremeSignalAlerts({ assets: [asset(symbol, 80)], previousState: baseline.nextState, now: 2_000 });
    const exitedBeforeCooldown = evaluateExtremeSignalAlerts({ assets: [asset(symbol, 79)], previousState: crossed.nextState, now: 61_000 });
    const reenteredBeforeCooldown = evaluateExtremeSignalAlerts({ assets: [asset(symbol, 80)], previousState: exitedBeforeCooldown.nextState, now: 121_000 });
    const sustainedAfterCooldown = evaluateExtremeSignalAlerts({ assets: [asset(symbol, 85)], previousState: crossed.nextState, now: 2_000 + ALERT_COOLDOWN_MS + 1 });
    const exited = evaluateExtremeSignalAlerts({ assets: [asset(symbol, 79)], previousState: sustainedAfterCooldown.nextState, now: 2_000 + ALERT_COOLDOWN_MS + 61_000 });
    const reenteredAfterCooldown = evaluateExtremeSignalAlerts({ assets: [asset(symbol, 80)], previousState: exited.nextState, now: 2_000 + ALERT_COOLDOWN_MS + 121_000 });

    expect(baseline.alerts).toEqual([]);
    expect(crossed.alerts).toHaveLength(1);
    expect(crossed.alerts[0]).toMatchObject({ assetSymbol: symbol, type: 'strong-buy', score: 80 });
    expect(sustainedAfterCooldown.alerts).toEqual([]);
    expect(reenteredBeforeCooldown.alerts).toEqual([]);
    expect(reenteredAfterCooldown.alerts).toHaveLength(1);
    expect(reenteredAfterCooldown.alerts[0]).toMatchObject({ assetSymbol: symbol, type: 'strong-buy', score: 80 });
  });

  it.each(['BTC', 'ETH'] as const)('validates %s strong-sell crossing, sustained zone silence, cooldown, and re-entry', (symbol) => {
    const baseline = evaluateExtremeSignalAlerts({ assets: [asset(symbol, 21)], previousState: {}, now: 1_000 });
    const crossed = evaluateExtremeSignalAlerts({ assets: [asset(symbol, 20)], previousState: baseline.nextState, now: 2_000 });
    const exitedBeforeCooldown = evaluateExtremeSignalAlerts({ assets: [asset(symbol, 21)], previousState: crossed.nextState, now: 61_000 });
    const reenteredBeforeCooldown = evaluateExtremeSignalAlerts({ assets: [asset(symbol, 20)], previousState: exitedBeforeCooldown.nextState, now: 121_000 });
    const sustainedAfterCooldown = evaluateExtremeSignalAlerts({ assets: [asset(symbol, 15)], previousState: crossed.nextState, now: 2_000 + ALERT_COOLDOWN_MS + 1 });
    const exited = evaluateExtremeSignalAlerts({ assets: [asset(symbol, 21)], previousState: sustainedAfterCooldown.nextState, now: 2_000 + ALERT_COOLDOWN_MS + 61_000 });
    const reenteredAfterCooldown = evaluateExtremeSignalAlerts({ assets: [asset(symbol, 20)], previousState: exited.nextState, now: 2_000 + ALERT_COOLDOWN_MS + 121_000 });

    expect(baseline.alerts).toEqual([]);
    expect(crossed.alerts).toHaveLength(1);
    expect(crossed.alerts[0]).toMatchObject({ assetSymbol: symbol, type: 'strong-sell', score: 20 });
    expect(sustainedAfterCooldown.alerts).toEqual([]);
    expect(reenteredBeforeCooldown.alerts).toEqual([]);
    expect(reenteredAfterCooldown.alerts).toHaveLength(1);
    expect(reenteredAfterCooldown.alerts[0]).toMatchObject({ assetSymbol: symbol, type: 'strong-sell', score: 20 });
  });

  it('keeps opposite alert types independent for the same asset during cooldown', () => {
    const previousState: ExtremeSignalAlertState = {
      BTC: { previousScore: 21, lastSentAt: { 'strong-buy': 10_000 } },
    };

    const result = evaluateExtremeSignalAlerts({ assets: [asset('BTC', 20)], previousState, now: 10_000 + ALERT_COOLDOWN_MS - 1 });

    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0]).toMatchObject({ assetSymbol: 'BTC', type: 'strong-sell', score: 20 });
  });

  it('preserves a six-hour cooldown for each altcoin and restores its persisted alert state', () => {
    const sentAt = 10_000;
    const persisted = serializeAlertState({ SHIB: { previousScore: 79, lastSentAt: { 'strong-buy': sentAt } } });
    const previousState = parseStoredAlertState(persisted);
    expect(previousState).toEqual({ SHIB: { previousScore: 79, lastSentAt: { 'strong-buy': sentAt } } });

    const blocked = evaluateExtremeSignalAlerts({ assets: [asset('SHIB', 82)], previousState, now: sentAt + ALERT_COOLDOWN_MS - 1 });
    expect(blocked.alerts).toEqual([]);

    const exited = evaluateExtremeSignalAlerts({ assets: [asset('SHIB', 70)], previousState: blocked.nextState, now: sentAt + ALERT_COOLDOWN_MS });
    const reentered = evaluateExtremeSignalAlerts({ assets: [asset('SHIB', 82)], previousState: exited.nextState, now: sentAt + ALERT_COOLDOWN_MS + 1 });
    expect(reentered.alerts).toHaveLength(1);
    expect(reentered.alerts[0]).toMatchObject({ assetSymbol: 'SHIB', type: 'strong-buy', score: 82 });
  });

  it('ignores corrupted local storage state and serializes a recoverable state', () => {
    expect(parseStoredAlertState('{bad json')).toEqual({});
    expect(parseStoredAlertState('{"BTC":{"previousScore":"oops"}}')).toEqual({});

    const state: ExtremeSignalAlertState = { BTC: { previousScore: 81, lastSentAt: { 'strong-buy': 1234 } } };
    expect(parseStoredAlertState(serializeAlertState(state))).toEqual(state);
  });

  it('builds Korean messages from the actual extreme indicators and score values', () => {
    const buyMessage = buildExtremeSignalAlertMessage({ asset: asset('BTC', 82), type: 'strong-buy', score: 82, createdAt: 1_000 });
    expect(buyMessage.title).toBe('🚨 [강력 매수 시그널] BTC 종합 점수 82점 달성!');
    expect(buyMessage.details).toContain('RSI 과매도');
    expect(buyMessage.details).toContain('극단적 공포');
    expect(buyMessage.details).toContain('상승 추세 정렬');
    expect(buyMessage.recommendedAction).toBe('적극적인 분할 매수 타점입니다.');

    const sellIndicators: AssetSignal['indicators'] = [
      { id: 'rsi', title: 'RSI (14)', value: '76.00', score: 0, maxScore: 20, interpretation: 'RSI 70 이상 과매수 구간은 점수를 받지 않습니다.' },
      { id: 'fear-greed', title: '공포·탐욕 지수', value: '82', score: 0, maxScore: 15, interpretation: '극단적 탐욕 구간은 심리 가산점을 받지 않습니다.' },
      { id: 'futures-positioning', title: '선물 펀딩비·미체결약정', value: '0.0450% / OI 3.00%', score: 2, maxScore: 20, interpretation: '높은 양수 펀딩과 OI 증가가 겹쳐 레버리지 과열로 크게 감점합니다.' },
    ];
    const sellMessage = buildExtremeSignalAlertMessage({ asset: asset('ETH', 18, sellIndicators), type: 'strong-sell', score: 18, createdAt: 2_000 });
    expect(sellMessage.title).toBe('⚠️ [강력 매도 시그널] ETH 종합 점수 18점 하락!');
    expect(sellMessage.details).toContain('RSI 과열');
    expect(sellMessage.details).toContain('극단적 탐욕');
    expect(sellMessage.details).toContain('선물 펀딩비 극도 과열');
    expect(sellMessage.recommendedAction).toBe('수익 중이라면 즉시 분할 익절 또는 현금화를 권장합니다.');
  });
});
