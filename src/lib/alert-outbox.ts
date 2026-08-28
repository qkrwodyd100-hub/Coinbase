import { ALERT_COOLDOWN_MS, type ExtremeSignalAlertType } from '@/lib/alerts';
import type { AssetSignal, CoverageRegime } from '@/lib/signals';

export type DurableAlertState = {
  previousScore: number;
  signalBarClose: string;
  coverageRegime: CoverageRegime;
  extremeEligible: boolean;
  lastSentAt: Partial<Record<ExtremeSignalAlertType, number>>;
};

export type DurableAlertEvent = {
  key: string;
  assetSymbol: AssetSignal['symbol'];
  type: ExtremeSignalAlertType;
  previousScore: number;
  score: number;
  signalTimeframe: AssetSignal['signalTimeframe'];
  signalBarClose: string;
  createdAt: number;
  message: string;
};

export function evaluateAssetSnapshot({
  asset,
  previousState,
  now,
  hasPendingForType,
}: {
  asset: AssetSignal;
  previousState: DurableAlertState | undefined;
  now: number;
  hasPendingForType: boolean;
}): { event: DurableAlertEvent | null; nextState: DurableAlertState } {
  const nextState: DurableAlertState = {
    previousScore: asset.overallScore,
    signalBarClose: asset.signalBarClose,
    coverageRegime: asset.coverageRegime,
    extremeEligible: asset.extremeEligible,
    lastSentAt: { ...(previousState?.lastSentAt ?? {}) },
  };
  if (!previousState || Date.parse(asset.signalBarClose) <= Date.parse(previousState.signalBarClose)) {
    return { event: null, nextState: previousState ?? nextState };
  }

  const coverageChanged = previousState.coverageRegime !== asset.coverageRegime || previousState.extremeEligible !== asset.extremeEligible;
  const type = asset.extremeEligible && !coverageChanged ? alertTypeForCrossing(previousState.previousScore, asset.overallScore) : null;
  if (!type || hasPendingForType) return { event: null, nextState };

  const lastSentAt = previousState.lastSentAt[type];
  if (lastSentAt !== undefined && now - lastSentAt < ALERT_COOLDOWN_MS) {
    return { event: null, nextState };
  }

  const event: DurableAlertEvent = {
    key: `${asset.symbol}:${type}:${asset.signalBarClose}`,
    assetSymbol: asset.symbol,
    type,
    previousScore: previousState.previousScore,
    score: asset.overallScore,
    signalTimeframe: asset.signalTimeframe,
    signalBarClose: asset.signalBarClose,
    createdAt: now,
    message: buildDurableAlertMessage(asset, type, previousState.previousScore),
  };
  return { event, nextState };
}

function alertTypeForCrossing(previousScore: number, currentScore: number): ExtremeSignalAlertType | null {
  if (previousScore < 80 && currentScore >= 80) return 'strong-buy';
  if (previousScore > 20 && currentScore <= 20) return 'strong-sell';
  return null;
}

function buildDurableAlertMessage(asset: AssetSignal, type: ExtremeSignalAlertType, previousScore: number): string {
  const threshold = type === 'strong-buy' ? 80 : 20;
  const availableFeatures = asset.features.filter((feature) => feature.status === 'available').length;
  const staleFeatures = asset.features.filter((feature) => feature.status === 'stale').length;
  const missingFeatures = asset.features.filter((feature) => feature.status === 'missing').length;
  const oldestAvailableAt = asset.features
    .flatMap((feature) => (feature.availableAt ? [Date.parse(feature.availableAt)] : []))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)[0];
  const freshness = oldestAvailableAt === undefined ? 'feature timestamp 없음' : `oldest availableAt ${new Date(oldestAvailableAt).toISOString()}`;
  const invalidation = type === 'strong-buy'
    ? '다음 닫힌 봉 점수가 80 아래로 내려가거나 freshness/coverage가 full이 아니면 무효입니다.'
    : '다음 닫힌 봉 점수가 20 위로 올라가거나 freshness/coverage가 full이 아니면 무효입니다.';

  return [
    `${type === 'strong-buy' ? '강력 매수' : '강력 매도'} watchlist: ${asset.symbol}`,
    `점수 crossing: ${previousScore} → ${asset.overallScore} (threshold ${threshold})`,
    `시간축: ${asset.signalTimeframe} 닫힌 봉 · close ${asset.signalBarClose}`,
    `feature freshness/coverage: ${asset.coverageRegime} · available ${availableFeatures}/${asset.features.length} · stale ${staleFeatures} · missing ${missingFeatures} · ${asset.availableWeight}/${asset.extremeCoverageFloor} · ${freshness}`,
    `리스크: 공개 데이터 기반 heuristic 알림이며 투자 조언이나 거래 실행이 아닙니다. 손절·수익·확률 모델은 검증되지 않았습니다.`,
    `무효화: ${invalidation}`,
  ].join('\n');
}
