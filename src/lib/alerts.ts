import { ASSET_SYMBOLS, type AssetSignal, type CoverageRegime, type IndicatorId } from '@/lib/signals';

export const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export type ExtremeSignalAlertType = 'strong-buy' | 'strong-sell';

export type ExtremeSignalAlertState = Partial<
  Record<
    AssetSignal['symbol'],
    {
      previousScore: number;
      lastTriggeredAt: Partial<Record<ExtremeSignalAlertType, number>>;
      coverageRegime?: CoverageRegime;
      extremeEligible?: boolean;
    }
  >
>;

export type ExtremeSignalAlertMessage = {
  title: string;
  details: string;
  recommendedAction: string;
};

export type ExtremeSignalAlert = ExtremeSignalAlertMessage & {
  assetSymbol: AssetSignal['symbol'];
  type: ExtremeSignalAlertType;
  score: number;
  createdAt: number;
};

export function evaluateExtremeSignalAlerts({
  assets,
  previousState,
  now,
}: {
  assets: AssetSignal[];
  previousState: ExtremeSignalAlertState;
  now: number;
}): { alerts: ExtremeSignalAlert[]; nextState: ExtremeSignalAlertState } {
  const nextState: ExtremeSignalAlertState = {};
  const alerts: ExtremeSignalAlert[] = [];

  for (const asset of assets) {
    const previousAssetState = previousState[asset.symbol];
    const previousScore = previousAssetState?.previousScore;
    const lastTriggeredAt = { ...(previousAssetState?.lastTriggeredAt ?? {}) };
    const coverageChanged =
      (previousAssetState?.coverageRegime !== undefined && previousAssetState.coverageRegime !== asset.coverageRegime) ||
      (previousAssetState?.extremeEligible !== undefined && previousAssetState.extremeEligible !== asset.extremeEligible);
    const type = asset.extremeEligible && !coverageChanged ? alertTypeForCrossing(previousScore, asset.overallScore) : null;

    if (type) {
      const lastTriggered = lastTriggeredAt[type];
      if (lastTriggered === undefined || now - lastTriggered >= ALERT_COOLDOWN_MS) {
        const message = buildExtremeSignalAlertMessage({ asset, type, score: asset.overallScore, createdAt: now });
        alerts.push({ ...message, assetSymbol: asset.symbol, type, score: asset.overallScore, createdAt: now });
        lastTriggeredAt[type] = now;
      }
    }

    nextState[asset.symbol] = {
      previousScore: asset.overallScore,
      lastTriggeredAt,
      coverageRegime: asset.coverageRegime,
      extremeEligible: asset.extremeEligible,
    };
  }

  return { alerts, nextState };
}

export function buildExtremeSignalAlertMessage({
  asset,
  type,
  score,
}: {
  asset: AssetSignal;
  type: ExtremeSignalAlertType;
  score: number;
  createdAt: number;
}): ExtremeSignalAlertMessage {
  const isBuy = type === 'strong-buy';

  return {
    title: isBuy ? `🚨 [강력 매수 시그널] ${asset.symbol} 종합 점수 ${score}점 달성!` : `⚠️ [강력 매도 시그널] ${asset.symbol} 종합 점수 ${score}점 하락!`,
    details: summarizeAlertReasons(asset, type),
    recommendedAction: isBuy ? '적극적인 분할 매수 타점입니다.' : '수익 중이라면 즉시 분할 익절 또는 현금화를 권장합니다.',
  };
}

export function parseStoredAlertState(raw: string | null): ExtremeSignalAlertState {
  if (!raw) return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return {};

    const state: ExtremeSignalAlertState = {};
    for (const symbol of ASSET_SYMBOLS) {
      const assetState = parsed[symbol];
      if (!isRecord(assetState) || typeof assetState.previousScore !== 'number') continue;
      const persistedTriggers = isRecord(assetState.lastTriggeredAt)
        ? assetState.lastTriggeredAt
        : isRecord(assetState.lastSentAt)
          ? assetState.lastSentAt
          : null;
      if (!persistedTriggers) continue;

      const lastTriggeredAt: Partial<Record<ExtremeSignalAlertType, number>> = {};
      for (const type of ['strong-buy', 'strong-sell'] as const) {
        if (typeof persistedTriggers[type] === 'number') {
          lastTriggeredAt[type] = persistedTriggers[type];
        }
      }

      const coverageRegime = assetState.coverageRegime;
      const extremeEligible = assetState.extremeEligible;
      state[symbol] = {
        previousScore: assetState.previousScore,
        lastTriggeredAt,
        ...(coverageRegime === 'full' || coverageRegime === 'limited' || coverageRegime === 'insufficient' ? { coverageRegime } : {}),
        ...(typeof extremeEligible === 'boolean' ? { extremeEligible } : {}),
      };
    }

    return state;
  } catch {
    return {};
  }
}

export function serializeAlertState(state: ExtremeSignalAlertState): string {
  return JSON.stringify(state);
}

function alertTypeForCrossing(previousScore: number | undefined, currentScore: number): ExtremeSignalAlertType | null {
  if (previousScore === undefined) return null;
  if (previousScore < 80 && currentScore >= 80) return 'strong-buy';
  if (previousScore > 20 && currentScore <= 20) return 'strong-sell';
  return null;
}

function summarizeAlertReasons(asset: AssetSignal, type: ExtremeSignalAlertType): string {
  const reasons = asset.indicators.flatMap((indicator) => reasonForIndicator(indicator, type));
  const uniqueReasons = [...new Set(reasons)];
  if (uniqueReasons.length > 0) return uniqueReasons.join(', ');
  return type === 'strong-buy' ? '종합 점수에 기여한 주요 지표가 강한 매수 조건을 충족했습니다.' : '종합 점수를 끌어내린 주요 지표가 강한 매도 조건을 충족했습니다.';
}

function reasonForIndicator(indicator: AssetSignal['indicators'][number], type: ExtremeSignalAlertType): string[] {
  const value = parseFloat(indicator.value.replace(/,/g, ''));
  const ratio = indicator.maxScore === 0 ? 0 : indicator.score / indicator.maxScore;

  if (type === 'strong-buy') {
    const buyReason = buyReasonForIndicator(indicator.id, value, ratio);
    return buyReason ? [buyReason] : [];
  }

  const sellReason = sellReasonForIndicator(indicator.id, value, ratio, indicator.interpretation);
  return sellReason ? [sellReason] : [];
}

function buyReasonForIndicator(id: IndicatorId, value: number, ratio: number): string | null {
  if (id === 'rsi' && value <= 30) return 'RSI 과매도';
  if (id === 'mfi' && value <= 20) return '거래량 동반 과매도';
  if (id === 'fear-greed' && value <= 25) return '극단적 공포';
  if (id === 'moving-averages' && ratio >= 0.8) return '상승 추세 정렬';
  if (id === 'futures-positioning' && ratio >= 0.8) return '선물 포지션 우호적';
  return null;
}

function sellReasonForIndicator(id: IndicatorId, value: number, ratio: number, interpretation: string): string | null {
  if (id === 'rsi' && value >= 70) return 'RSI 과열';
  if (id === 'mfi' && value >= 80) return '거래량 동반 과열';
  if (id === 'fear-greed' && value > 75) return '극단적 탐욕';
  if (id === 'moving-averages' && ratio <= 0.2) return '약세 추세 정렬';
  if (id === 'futures-positioning' && (value > 0.03 || interpretation.includes('과열'))) return '선물 펀딩비 극도 과열';
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
