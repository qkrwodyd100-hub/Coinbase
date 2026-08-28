'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  evaluateExtremeSignalAlerts,
  parseStoredAlertState,
  serializeAlertState,
  type ExtremeSignalAlert,
  type ExtremeSignalAlertState,
} from '@/lib/alerts';
import { ASSET_SYMBOLS, formatUsdWithKrw, type AssetSignal, type AssetSymbol, type DashboardPayload, type IndicatorId, type IndicatorScore, type SignalTone } from '@/lib/signals';

type LoadState = 'loading' | 'refreshing' | 'success' | 'failure';

const REFRESH_INTERVAL_MS = 60_000;
const ALERT_STATE_STORAGE_KEY = 'crypto-signal-dashboard:extreme-alert-state';
const ALERT_HISTORY_STORAGE_KEY = 'crypto-signal-dashboard:extreme-alert-history';
const ALERT_ENABLED_STORAGE_KEY = 'crypto-signal-dashboard:extreme-alert-enabled';
const MAX_ALERT_HISTORY = 10;

type IndicatorDetailMetadata = {
  what: string;
  calculation: string;
  scoreBasis: string;
  interpretation: string;
  source: string;
  limitations: string;
};

const INVESTMENT_CAVEAT = '보조지표이며 단독 매수·매도 판단 근거가 아닙니다. 가격, 리스크 한도, 포지션 규모, 시간 지평과 함께 확인해야 합니다.';

const INDICATOR_DETAILS: Record<IndicatorId, IndicatorDetailMetadata> = {
  'moving-averages': {
    what: '현재가가 MA20·MA50 대비 어디에 있는지 확인해 중기 추세 정렬과 단기 이격을 함께 보는 추세 지표입니다.',
    calculation: '최근 종가 20개와 50개의 단순 이동평균을 계산하고, 현재가와 MA20의 이격률 및 MA20/MA50 배열을 비교합니다.',
    scoreBasis: 'MA20이 MA50 위에 있고 현재가가 MA20 이상이며 이격이 5% 이내면 최대 점수를 주고, 과열 이격·MA20 이탈·약세 배열일수록 감점합니다.',
    interpretation: '상승 정렬은 추세 참여 가능성을 높이지만, MA20 이격이 커질수록 추격 매수 리스크가 커집니다.',
    source: 'Binance 현물 캔들 종가와 대시보드의 USD/KRW 환율을 사용합니다.',
    limitations: '이동평균은 후행 지표라 급락·급등 전환을 늦게 반영하며, 횡보장에서는 잦은 속임수가 생길 수 있습니다.',
  },
  rsi: {
    what: 'RSI는 최근 상승폭과 하락폭의 상대 강도를 비교해 과매도·과매수 구간을 추정하는 모멘텀 지표입니다.',
    calculation: '현재 대시보드는 14기간 종가 변화로 RSI(14)를 계산합니다.',
    scoreBasis: 'RSI 30 이하는 과매도 구간으로 높은 점수를, 70 이상은 과매수 구간으로 0점을 부여합니다.',
    interpretation: '낮은 RSI는 반등 후보를 찾는 데 도움을 주지만 강한 하락 추세에서는 낮은 RSI가 오래 지속될 수 있습니다.',
    source: 'Binance 현물 캔들 종가를 사용합니다.',
    limitations: 'RSI는 방향 전환 확정 신호가 아니며, 추세·거래량·선물 포지셔닝과 함께 봐야 합니다.',
  },
  mfi: {
    what: 'MFI는 가격과 거래량을 함께 사용해 자금 흐름이 과매도 또는 과매수에 가까운지 보는 지표입니다.',
    calculation: '14기간의 typical price와 거래량으로 양·음의 money flow를 계산해 MFI(14)를 산출합니다.',
    scoreBasis: 'MFI 20 이하는 거래량이 동반된 과매도 가능성으로 높은 점수를 주고, 80 이상은 과매수로 0점을 줍니다.',
    interpretation: '낮은 MFI는 매도 압력 소진 가능성을 시사하지만, 거래량 급변이나 거래소별 유동성 차이에 민감합니다.',
    source: 'Binance 현물 캔들 가격과 거래량을 사용합니다.',
    limitations: '거래량 데이터 품질과 거래소 커버리지에 의존하며, 단독으로 바닥을 확정하지 못합니다.',
  },
  funding: {
    what: '펀딩비는 무기한 선물 시장에서 롱·숏 포지션 쏠림과 레버리지 과열을 추정하는 지표입니다.',
    calculation: 'Binance 무기한 선물의 최근 펀딩비율을 퍼센트로 표시합니다.',
    scoreBasis: '음수 또는 중립 펀딩은 롱 과열이 낮다고 보고 높은 점수를, 높은 양수 펀딩은 낮은 점수를 줍니다.',
    interpretation: '양수 펀딩이 높을수록 롱 포지션 비용과 청산 리스크가 커질 수 있습니다.',
    source: 'Binance 선물 펀딩비 데이터를 사용합니다.',
    limitations: '펀딩비는 거래소·시점별로 달라질 수 있고, 강한 추세에서는 높은 펀딩이 즉시 하락을 뜻하지 않습니다.',
  },
  'futures-positioning': {
    what: '펀딩비와 미체결약정(OI)을 결합해 선물 시장 레버리지 쏠림과 추세 참여 여부를 보는 포지셔닝 지표입니다.',
    calculation: '최근 Binance 선물 펀딩비율과 미체결약정 변화율, 가격 변화 방향을 함께 비교합니다.',
    scoreBasis: '중립·음수 펀딩과 건전한 가격/OI 동행은 가점, 높은 양수 펀딩과 OI 증가는 레버리지 과열로 감점합니다.',
    interpretation: '가격 상승과 OI 증가가 함께 나타나면 추세 참여로 볼 수 있지만, 과도한 펀딩과 겹치면 반대 청산 리스크도 커집니다.',
    source: 'Binance 선물 펀딩비와 미체결약정 데이터를 사용합니다.',
    limitations: 'OI 결측 또는 지연 시 펀딩 가중치만 사용하며, 거래소별 포지션 분포는 반영하지 못합니다.',
  },
  'fear-greed': {
    what: '공포·탐욕 지수는 시장 심리를 0~100으로 압축해 역발상 관점의 과열·침체를 보는 보조 지표입니다.',
    calculation: 'Alternative.me의 Crypto Fear & Greed Index 최신 값을 사용합니다.',
    scoreBasis: '25 이하 극단적 공포는 높은 역발상 점수, 75 초과 극단적 탐욕은 0점을 부여합니다.',
    interpretation: '공포 구간은 장기 분할 매수 후보를 찾는 데 유용하지만, 공포가 더 심해지는 구간에서는 손실 변동성이 큽니다.',
    source: 'Alternative.me Crypto Fear & Greed Index를 사용합니다.',
    limitations: '전체 암호화폐 시장 심리 지표라 BTC/ETH 개별 수급을 직접 설명하지는 못합니다.',
  },
  'eth-btc-strength': {
    what: 'ETH/BTC 상대강도는 ETH가 BTC 대비 강한지 약한지를 보며 ETH 점수에 작은 보정값으로 반영하는 지표입니다.',
    calculation: 'ETH/BTC 현재 비율과 20봉 이동평균의 이격을 -2%~+2% 범위에서 0~100점으로 정규화합니다.',
    scoreBasis: 'ETH 최종 점수는 기본 지표 95%와 ETH/BTC 상대강도 정규화 점수 5%를 혼합합니다.',
    interpretation: 'ETH/BTC가 MA20보다 강하면 ETH 선호도가 소폭 올라가지만, 전체 시장 하락 리스크를 상쇄하지는 못합니다.',
    source: 'ETH/BTC 가격 비율과 20봉 이동평균 데이터를 사용합니다.',
    limitations: '상대강도는 ETH만의 보정 지표이며 BTC 화면에는 표시되지 않을 수 있습니다.',
  },
  'alt-btc-strength': {
    what: 'ALT/BTC 상대강도는 해당 알트코인이 BTC 대비 강한지 보는 상대 모멘텀 지표입니다.',
    calculation: 'ALT/BTC 현재 비율과 20봉 단순 이동평균의 이격률을 계산합니다.',
    scoreBasis: 'MA20보다 2% 이상 강하면 15점, 2% 이상 약하면 0점이며 중간 구간은 방향별 부분 점수를 부여합니다.',
    interpretation: 'BTC 대비 강세는 알트 자체 모멘텀을 보완하지만 시장 전체 리스크를 상쇄하지는 않습니다.',
    source: 'Binance 현물 ALT/BTC 캔들을 사용합니다.',
    limitations: 'SHIB처럼 직접 BTC 페어가 없거나 데이터가 부족하면 이 지표를 제외하고 사용 가능한 가중치만 정규화합니다.',
  },
};

export default function Home() {
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<AssetSymbol>('BTC');
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [alertsEnabled, setAlertsEnabled] = useState(true);
  const [alertState, setAlertState] = useState<ExtremeSignalAlertState>({});
  const [alertHistory, setAlertHistory] = useState<ExtremeSignalAlert[]>([]);
  const [latestAlert, setLatestAlert] = useState<ExtremeSignalAlert | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>('unsupported');
  const [storageHydrated, setStorageHydrated] = useState(false);
  const requestGeneration = useRef(0);
  const alertStateRef = useRef(alertState);
  const alertsEnabledRef = useRef(alertsEnabled);

  useEffect(() => {
    const storedAlertsEnabled = readStoredBoolean(ALERT_ENABLED_STORAGE_KEY, true);
    const storedAlertState = readStoredAlertState();
    alertsEnabledRef.current = storedAlertsEnabled;
    alertStateRef.current = storedAlertState;
    setAlertsEnabled(storedAlertsEnabled);
    setAlertState(storedAlertState);
    setAlertHistory(readStoredAlertHistory());
    setNotificationPermission(getNotificationPermission());
    setStorageHydrated(true);
  }, []);

  useEffect(() => {
    if (!storageHydrated) return;
    alertStateRef.current = alertState;
    safeLocalStorageSet(ALERT_STATE_STORAGE_KEY, serializeAlertState(alertState));
  }, [alertState, storageHydrated]);

  useEffect(() => {
    if (!storageHydrated) return;
    alertsEnabledRef.current = alertsEnabled;
    safeLocalStorageSet(ALERT_ENABLED_STORAGE_KEY, alertsEnabled ? 'true' : 'false');
  }, [alertsEnabled, storageHydrated]);

  useEffect(() => {
    if (!storageHydrated) return;
    safeLocalStorageSet(ALERT_HISTORY_STORAGE_KEY, JSON.stringify(alertHistory));
  }, [alertHistory, storageHydrated]);

  const refreshSignals = useCallback(async () => {
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    setLoadState((current) => (current === 'loading' ? 'loading' : 'refreshing'));
    setError(null);

    try {
      const response = await fetch('/api/signals', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('시장 데이터를 새로고침하지 못했습니다.');
      }
      const nextPayload = (await response.json()) as DashboardPayload;
      if (generation !== requestGeneration.current) return;
      const alertResult = evaluateExtremeSignalAlerts({ assets: nextPayload.assets, previousState: alertStateRef.current, now: Date.now() });
      alertStateRef.current = alertResult.nextState;
      setPayload(nextPayload);
      setAlertState(alertResult.nextState);
      if (alertsEnabledRef.current && alertResult.alerts.length > 0) {
        setLatestAlert(alertResult.alerts[0]);
        setAlertHistory((current) => [...alertResult.alerts, ...current].slice(0, MAX_ALERT_HISTORY));
        showBrowserNotifications(alertResult.alerts);
      }
      setLoadState('success');
      setSelectedSymbol((current) => (nextPayload.assets.some((asset) => asset.symbol === current) ? current : (nextPayload.assets[0]?.symbol ?? 'BTC')));
    } catch (refreshError) {
      if (generation !== requestGeneration.current) return;
      setError(refreshError instanceof Error ? refreshError.message : '크립토 시그널을 새로고침하지 못했습니다.');
      setLoadState('failure');
    }
  }, []);

  useEffect(() => {
    void refreshSignals();
  }, [refreshSignals]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshSignals();
    }, REFRESH_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [refreshSignals]);

  const requestBrowserNotifications = useCallback(async () => {
    if (!('Notification' in window)) {
      setNotificationPermission('unsupported');
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
  }, []);

  const selectedAsset = useMemo(
    () => payload?.assets.find((asset) => asset.symbol === selectedSymbol) ?? payload?.assets[0] ?? null,
    [payload, selectedSymbol],
  );
  const isBusy = loadState === 'loading' || loadState === 'refreshing';
  const hasStaleData = Boolean(payload && loadState === 'failure');

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#080b14] text-slate-50">
      <div className="absolute inset-0 -z-0 bg-[radial-gradient(circle_at_top_left,rgba(47,118,255,0.30),transparent_35%),radial-gradient(circle_at_80%_10%,rgba(20,184,166,0.18),transparent_28%),linear-gradient(135deg,#080b14,#101827_48%,#050608)]" />
      <section className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-6 flex flex-col gap-4 rounded-[2rem] border border-white/10 bg-white/[0.06] p-5 shadow-2xl shadow-black/30 backdrop-blur md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium uppercase tracking-[0.28em] text-cyan-200/80 sm:tracking-[0.32em]">일일 닫힌 봉 시장 시그널</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-5xl">크립토 시그널 대시보드</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
              UTC 기준으로 완전히 닫힌 1일 봉에서 MA20/MA50, RSI(14), MFI(14), 선물 포지셔닝과 공포·탐욕 지수를 재현 가능하게 계산합니다.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-300">
              <span className="block text-xs uppercase tracking-[0.22em] text-slate-500">마지막 업데이트</span>
              <time>{payload ? new Date(payload.asOf).toLocaleTimeString('ko-KR', { hour12: false, timeZone: 'UTC' }) : '대기 중...'}</time>
            </div>
            <button
              type="button"
              onClick={() => void refreshSignals()}
              disabled={isBusy}
              aria-label={isBusy ? '시그널 새로고침 중' : '시그널 새로고침'}
              className="rounded-2xl bg-cyan-300 px-5 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-cyan-950/30 transition hover:-translate-y-0.5 hover:bg-cyan-200 disabled:translate-y-0 disabled:cursor-wait disabled:bg-slate-500"
            >
              {isBusy ? '새로고침 중…' : '새로고침'}
            </button>
          </div>
        </header>

        {error ? (
          <div role="alert" className="mb-5 rounded-2xl border border-rose-400/40 bg-rose-500/10 p-4 text-sm text-rose-100">
            <strong>시그널을 새로고침하지 못했습니다.</strong> {hasStaleData ? '마지막으로 성공한 스냅샷을 표시합니다.' : '잠시 후 다시 시도해 주세요.'}
          </div>
        ) : null}

        {payload?.fxUnavailable ? (
          <p className="mb-5 rounded-2xl border border-amber-300/30 bg-amber-300/10 p-3 text-sm font-medium text-amber-100" role="status">
            원화 환산을 잠시 표시할 수 없습니다. USD 가격과 시그널은 계속 최신 데이터로 표시합니다.
          </p>
        ) : null}

        {latestAlert ? <InAppAlert alert={latestAlert} /> : null}

        {!selectedAsset && loadState === 'loading' ? <DashboardSkeleton /> : null}
        {selectedAsset ? (
          <DashboardContent
            assets={payload?.assets ?? []}
            selectedAsset={selectedAsset}
            selectedSymbol={selectedSymbol}
            onSelect={setSelectedSymbol}
            stale={hasStaleData || selectedAsset.stale}
            usdKrwRate={payload?.usdKrwRate ?? null}
            backtestSummary={payload?.backtestSummary ?? null}
            alertsEnabled={alertsEnabled}
            onToggleAlerts={setAlertsEnabled}
            notificationPermission={notificationPermission}
            onRequestBrowserNotifications={requestBrowserNotifications}
            alertHistory={alertHistory}
          />
        ) : null}
      </section>
    </main>
  );
}

function DashboardContent({
  assets,
  selectedAsset,
  selectedSymbol,
  onSelect,
  stale,
  usdKrwRate,
  backtestSummary,
  alertsEnabled,
  onToggleAlerts,
  notificationPermission,
  onRequestBrowserNotifications,
  alertHistory,
}: {
  assets: AssetSignal[];
  selectedAsset: AssetSignal;
  selectedSymbol: AssetSymbol;
  onSelect: (symbol: AssetSymbol) => void;
  stale: boolean;
  usdKrwRate: number | null;
  backtestSummary: DashboardPayload['backtestSummary'] | null;
  alertsEnabled: boolean;
  onToggleAlerts: (enabled: boolean) => void;
  notificationPermission: NotificationPermission | 'unsupported';
  onRequestBrowserNotifications: () => void;
  alertHistory: ExtremeSignalAlert[];
}) {
  const [selectedIndicatorId, setSelectedIndicatorId] = useState<IndicatorId | null>(null);
  const indicatorButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const selectedIndicator = selectedIndicatorId ? (selectedAsset.indicators.find((indicator) => indicator.id === selectedIndicatorId) ?? null) : null;
  const selectedContribution = selectedIndicator ? calculateIndicatorContribution(selectedIndicator, selectedAsset) : 0;
  const missingFeatures = selectedAsset.missingFeatures ?? [];

  useEffect(() => {
    setSelectedIndicatorId(null);
  }, [selectedAsset.symbol]);

  const closeIndicatorDetail = useCallback(() => {
    const triggerKey = selectedIndicator ? indicatorTriggerKey(selectedAsset.symbol, selectedIndicator.id) : null;
    setSelectedIndicatorId(null);
    if (triggerKey) {
      window.requestAnimationFrame(() => indicatorButtonRefs.current[triggerKey]?.focus());
    }
  }, [selectedAsset.symbol, selectedIndicator]);

  const selectAsset = useCallback(
    (symbol: AssetSymbol) => {
      setSelectedIndicatorId(null);
      onSelect(symbol);
    },
    [onSelect],
  );

  return (
    <div className="grid min-w-0 flex-1 gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="min-w-0 space-y-4">
        <div
          role="tablist"
          aria-label="자산 탭 목록"
          className="flex min-w-0 snap-x snap-mandatory gap-3 overflow-x-auto pb-2 pr-4 lg:grid lg:snap-none lg:overflow-visible lg:pb-0 lg:pr-0"
        >
          {assets.map((asset) => (
            <button
              key={asset.symbol}
              type="button"
              role="tab"
              aria-selected={asset.symbol === selectedSymbol}
              onClick={() => selectAsset(asset.symbol)}
              className="min-w-[13rem] snap-start rounded-3xl border border-white/10 bg-white/[0.06] p-4 text-left transition hover:bg-white/[0.10] focus:outline-none focus:ring-2 focus:ring-cyan-200/80 focus:ring-offset-2 focus:ring-offset-slate-950 motion-reduce:transition-none aria-selected:border-cyan-200/80 aria-selected:bg-cyan-200/15 lg:min-w-0"
            >
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-xl font-black">{asset.symbol}</span>
                  <span className="ml-2 text-sm text-slate-400">{asset.name}</span>
                </div>
                <SignalPill tone={asset.signal.tone}>{asset.signal.label}</SignalPill>
              </div>
              <div className="mt-4 break-words text-xl font-black leading-tight sm:text-2xl">{formatUsdWithKrw(asset.price, usdKrwRate)}</div>
              <div className="mt-2 h-2 rounded-full bg-white/10">
                <div className={barClass(asset.signal.tone)} style={{ width: `${asset.overallScore}%` }} />
              </div>
            </button>
          ))}
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-5 text-sm leading-6 text-slate-300">
          <h2 className="font-bold text-slate-100">점수 산정 메모</h2>
          <p className="mt-2">
            지표 결측은 0점이나 만점으로 숨기지 않고 사용 가능한 가중치를 정규화합니다. 단, 100% coverage가 아니거나 stale이면 강력 매수·매도 판정과 이벤트는 fail-closed됩니다.
          </p>
        </div>
        <AlertSettings
          enabled={alertsEnabled}
          onToggle={onToggleAlerts}
          notificationPermission={notificationPermission}
          onRequestBrowserNotifications={onRequestBrowserNotifications}
          history={alertHistory}
        />
        {backtestSummary ? <BacktestSummary summary={backtestSummary} /> : null}
      </aside>

      <section className="min-w-0 rounded-[2rem] border border-white/10 bg-white/[0.07] p-5 shadow-2xl shadow-black/30 backdrop-blur sm:p-7">
        <div className="flex min-w-0 flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="text-sm uppercase tracking-[0.28em] text-slate-400">{selectedAsset.symbol}</p>
            <h2 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">{selectedAsset.name} 시그널</h2>
            <p className="mt-2 break-words text-2xl font-black leading-tight sm:text-3xl">{formatUsdWithKrw(selectedAsset.price, usdKrwRate)}</p>
            {stale ? <p className="mt-2 text-sm font-semibold text-amber-200">오래된 데이터: 명시된 최대 허용 나이를 넘긴 feature 또는 캐시된 스냅샷이 포함되어 극단 판정을 차단합니다.</p> : null}
          </div>
          <ScoreGauge assetName={selectedAsset.name} score={selectedAsset.overallScore} tone={selectedAsset.signal.tone} label={selectedAsset.signal.label} />
        </div>

        <SignalDataContract asset={selectedAsset} />

        <div className="mt-7 flex min-w-0 flex-col gap-3 border-t border-white/10 pt-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200/70">Indicator stack</p>
            <h3 className="mt-1 text-2xl font-black tracking-tight text-slate-50">세부 지표</h3>
          </div>
          <p className="max-w-xl text-sm leading-6 text-slate-300">카드를 선택하면 계산 방식, 현재 배점, 데이터 출처와 한계를 확인할 수 있습니다.</p>
        </div>

        <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
          {selectedAsset.indicators.map((indicator) => (
            <button
              key={indicator.id}
              ref={(node) => {
                indicatorButtonRefs.current[indicatorTriggerKey(selectedAsset.symbol, indicator.id)] = node;
              }}
              type="button"
              aria-label={`${indicator.title} ${indicator.value} ${indicator.score}/${indicator.maxScore} 상세 설명 열기`}
              onClick={() => setSelectedIndicatorId(indicator.id)}
              className="group min-w-0 rounded-3xl border border-white/10 bg-slate-950/35 p-5 text-left transition hover:-translate-y-0.5 hover:border-cyan-200/50 hover:bg-slate-900/70 focus:outline-none focus:ring-2 focus:ring-cyan-200/80 focus:ring-offset-2 focus:ring-offset-slate-950 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-bold text-slate-100">{indicator.title}</h3>
                  {indicator.id === 'moving-averages' ? (
                    <ul aria-label="이동평균 가격" className="mt-2 min-w-0 space-y-2 text-lg font-black leading-tight sm:text-xl">
                      {indicator.value.split(' / ').map((priceRow, index) => (
                        <li key={priceRow} className="min-w-0 break-words">
                          {index === 0 ? `현재가 ${priceRow}` : priceRow}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 break-words text-xl font-black leading-tight sm:text-2xl">{indicator.value}</p>
                  )}
                </div>
                <span className="rounded-2xl bg-white/10 px-3 py-2 text-sm font-bold">
                  {indicator.score}/{indicator.maxScore}
                </span>
              </div>
              <div className="mt-4 h-2 rounded-full bg-white/10">
                <div className="h-2 rounded-full bg-cyan-300" style={{ width: `${(indicator.score / indicator.maxScore) * 100}%` }} />
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-300">{indicator.interpretation}</p>
              <span className="mt-4 inline-flex min-h-11 items-center rounded-2xl border border-cyan-200/20 px-3 text-xs font-bold text-cyan-100 transition group-hover:border-cyan-200/50 motion-reduce:transition-none">
                상세 설명 보기
              </span>
            </button>
          ))}
        </div>
        {missingFeatures.includes('funding') || missingFeatures.includes('open-interest') ? <UnavailableFuturesDataNotice missingFeatures={missingFeatures} /> : null}
      </section>
      {selectedIndicator ? (
        <IndicatorDetailDialog asset={selectedAsset} indicator={selectedIndicator} contribution={selectedContribution} onClose={closeIndicatorDetail} />
      ) : null}
    </div>
  );
}

function SignalDataContract({ asset }: { asset: AssetSignal }) {
  if (!asset.signalBarClose || !asset.coverageRegime) return null;

  return (
    <section aria-label={`${asset.symbol} 시그널 데이터 계약`} className="mt-6 rounded-3xl border border-cyan-200/20 bg-cyan-200/[0.06] p-5 text-sm" role="region">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-cyan-50">신호 데이터 계약</h3>
        <span className="rounded-full bg-cyan-200/10 px-3 py-1 font-bold text-cyan-100">{asset.signalTimeframe} 닫힌 봉</span>
      </div>
      <dl className="mt-4 grid gap-3 text-slate-300 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Signal bar</dt>
          <dd className="mt-1 break-all">{asset.signalBarOpen} → {asset.signalBarClose}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Coverage regime</dt>
          <dd className="mt-1 font-bold text-slate-100">{asset.coverageRegime} · {asset.availableWeight}/{asset.extremeCoverageFloor}</dd>
          <dd className="mt-1 text-xs">{asset.extremeEligible ? '극단 판정 가능' : '극단 판정 fail-closed'}</dd>
        </div>
      </dl>
      {asset.features?.length ? (
        <ul aria-label={`${asset.symbol} feature freshness`} className="mt-4 grid gap-2 sm:grid-cols-2">
          {asset.features.map((feature) => (
            <li key={feature.id} className="rounded-2xl border border-white/10 bg-black/20 p-3 text-xs text-slate-300">
              <strong className="text-slate-100">{feature.id}</strong> · {feature.source} · {feature.timeframe} · {feature.status}
              <span className="mt-1 block break-all">observed {feature.observedAt ?? 'missing'} · available {feature.availableAt ?? 'missing'} · max age {feature.maxAgeMs}ms</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function indicatorTriggerKey(symbol: AssetSignal['symbol'], indicatorId: IndicatorId): string {
  return `${symbol}:${indicatorId}`;
}

function calculateIndicatorContribution(indicator: IndicatorScore, asset: AssetSignal): number {
  if (indicator.id === 'eth-btc-strength') return indicator.score * 0.05;
  const baseIndicators = asset.indicators.filter((item) => item.id !== 'eth-btc-strength');
  const baseMaxScore = baseIndicators.reduce((total, item) => total + item.maxScore, 0);
  if (baseMaxScore === 0) return 0;
  const assetWeight = asset.symbol === 'ETH' && asset.indicators.some((item) => item.id === 'eth-btc-strength') ? 0.95 : 1;
  return (indicator.score / baseMaxScore) * 100 * assetWeight;
}

function IndicatorDetailDialog({
  asset,
  indicator,
  contribution,
  onClose,
}: {
  asset: AssetSignal;
  indicator: IndicatorScore;
  contribution: number;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const metadata = INDICATOR_DETAILS[indicator.id];
  const titleId = `indicator-detail-title-${asset.symbol}-${indicator.id}`;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !panelRef.current) return;
    const focusable = panelRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/75 p-0 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
        className="max-h-[88vh] w-full overflow-y-auto rounded-t-[2rem] border border-white/10 bg-[#101827] p-5 text-slate-100 shadow-2xl shadow-black/50 sm:max-w-3xl sm:rounded-[2rem] sm:p-7"
      >
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-cyan-200/70">{asset.symbol} indicator detail</p>
            <h2 id={titleId} className="mt-2 break-words text-2xl font-black tracking-tight sm:text-3xl">
              {indicator.title} 상세 설명
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">{asset.name} 현재 화면에 표시된 값과 점수를 기준으로 설명합니다.</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="지표 상세 설명 닫기"
            className="min-h-11 shrink-0 rounded-2xl border border-white/10 bg-white/10 px-4 text-sm font-black text-slate-100 transition hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-cyan-200/80 focus:ring-offset-2 focus:ring-offset-slate-950 motion-reduce:transition-none"
          >
            닫기
          </button>
        </div>

        <h3 className="mt-6 text-base font-black text-slate-100">현재 값과 배점</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <DetailMetric label="현재 값" value={indicator.value} />
          <DetailMetric label="현재 배점" value={`${indicator.score}/${indicator.maxScore}점`} />
          <DetailMetric label="총점 기여도" value={`${contribution.toFixed(1)}점`} />
        </div>

        <div className="mt-6 grid gap-4 text-sm leading-6 sm:grid-cols-2">
          <DetailSection title="무엇을 보는 지표인가요?" body={metadata.what} />
          <DetailSection title="현재 대시보드 계산 방식" body={metadata.calculation} />
          <DetailSection title="현재 점수의 구간·판정 근거" body={`${metadata.scoreBasis} 현재 판정: ${indicator.interpretation}`} />
          <DetailSection title="일반적인 해석과 주의점" body={metadata.interpretation} />
          <DetailSection title="데이터 출처" body={metadata.source} />
          <DetailSection title="결측·지역 제한·백테스트 한계" body={metadata.limitations} />
        </div>

        <p className="mt-6 rounded-2xl border border-amber-200/30 bg-amber-200/10 p-4 text-sm font-semibold leading-6 text-amber-100">{INVESTMENT_CAVEAT}</p>
      </div>
    </div>
  );
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-slate-950/45 p-4">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className="mt-2 break-words text-xl font-black text-slate-50">{value}</p>
    </div>
  );
}

function DetailSection({ title, body }: { title: string; body: string }) {
  return (
    <section className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <h3 className="font-black text-slate-100">{title}</h3>
      <p className="mt-2 text-slate-300">{body}</p>
    </section>
  );
}

function UnavailableFuturesDataNotice({ missingFeatures }: { missingFeatures: AssetSignal['missingFeatures'] }) {
  const fundingUnavailable = missingFeatures.includes('funding');

  return (
    <section className="mt-4 rounded-2xl border border-amber-200/30 bg-amber-200/10 p-4 text-sm leading-6 text-amber-50" aria-label="선물 데이터 결측 안내">
      <h3 className="font-black">{fundingUnavailable ? '선물 펀딩비와 미체결약정 데이터를 가져오지 못했습니다.' : '미체결약정 데이터를 가져오지 못했습니다.'}</h3>
      <p className="mt-1 text-amber-100">진단 점수는 사용 가능한 지표를 정규화하지만, coverage가 100%가 아니므로 강력 판정과 이벤트는 차단됩니다.</p>
    </section>
  );
}

function ScoreGauge({ assetName, score, tone, label }: { assetName: string; score: number; tone: SignalTone; label: string }) {
  const strokeClass = tone === 'positive' ? 'stroke-emerald-300' : tone === 'neutral' ? 'stroke-amber-300' : 'stroke-rose-300';
  const dash = `${score}, 100`;

  return (
    <div
      role="meter"
      aria-label={`${assetName} 시그널 점수`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={score}
      className="flex shrink-0 items-center gap-4 rounded-3xl border border-white/10 bg-black/20 p-4"
    >
      <svg viewBox="0 0 42 42" className="h-28 w-28 rotate-[-90deg]" aria-hidden="true">
        <circle cx="21" cy="21" r="15.9155" fill="transparent" stroke="rgba(255,255,255,0.12)" strokeWidth="4" />
        <circle
          cx="21"
          cy="21"
          r="15.9155"
          fill="transparent"
          className={strokeClass}
          strokeDasharray={dash}
          strokeLinecap="round"
          strokeWidth="4"
        />
      </svg>
      <div>
        <div className="text-4xl font-black">{score}</div>
        <div className="text-sm text-slate-400">100점 만점</div>
        <SignalPill tone={tone}>{label}</SignalPill>
      </div>
    </div>
  );
}

function AlertSettings({
  enabled,
  onToggle,
  notificationPermission,
  onRequestBrowserNotifications,
  history,
}: {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  notificationPermission: NotificationPermission | 'unsupported';
  onRequestBrowserNotifications: () => void;
  history: ExtremeSignalAlert[];
}) {
  return (
    <section className="min-w-0 rounded-3xl border border-cyan-200/20 bg-cyan-200/[0.07] p-5 text-sm leading-6 text-slate-200">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-bold text-slate-100">극단 시그널 알람</h2>
          <p className="mt-1 text-slate-300">fresh 100% coverage의 닫힌 봉에서만 80점 이상·20점 이하 재진입을 감시하며 자산·유형별 6시간 cooldown을 적용합니다.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="극단 시그널 알람 활성화"
          onClick={() => onToggle(!enabled)}
          className={`rounded-full px-4 py-2 text-xs font-black transition ${enabled ? 'bg-emerald-300 text-slate-950' : 'bg-slate-700 text-slate-200'}`}
        >
          {enabled ? '알람 켜짐' : '알람 꺼짐'}
        </button>
      </div>

      <div className="mt-4 rounded-2xl bg-black/20 p-3">
        <p className="font-semibold text-slate-100">브라우저 알림</p>
        <p className="mt-1 text-slate-300">권한을 거부하거나 지원하지 않아도 인앱 알림과 이력은 계속 동작합니다.</p>
        {notificationPermission === 'default' ? (
          <button type="button" onClick={onRequestBrowserNotifications} className="mt-3 rounded-2xl bg-cyan-300 px-4 py-2 text-xs font-black text-slate-950">
            브라우저 알림 허용
          </button>
        ) : (
          <p className="mt-2 text-xs text-cyan-100">{notificationPermissionText(notificationPermission)}</p>
        )}
      </div>

      <div className="mt-4">
        <h3 className="font-semibold text-slate-100">최근 알람 이력</h3>
        {history.length > 0 ? (
          <ul aria-label="최근 극단 시그널 알람 이력" className="mt-2 space-y-2">
            {history.map((alert) => (
              <li key={`${alert.assetSymbol}-${alert.type}-${alert.createdAt}`} className="min-w-0 break-words rounded-2xl bg-black/20 p-3">
                <span className="font-bold text-slate-100">{alert.title.replace(/^🚨 \[강력 매수 시그널\] |^⚠️ \[강력 매도 시그널\] /, '')}</span>
                <span className="block text-xs text-slate-400">{new Date(alert.createdAt).toLocaleTimeString('ko-KR', { hour12: false })}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-slate-400">아직 발생한 극단 시그널 알람이 없습니다.</p>
        )}
      </div>
    </section>
  );
}

function InAppAlert({ alert }: { alert: ExtremeSignalAlert }) {
  const isBuy = alert.type === 'strong-buy';
  const className = isBuy ? 'border-emerald-300/40 bg-emerald-300/15 text-emerald-50' : 'border-rose-300/40 bg-rose-300/15 text-rose-50';
  return (
    <section role="status" aria-label="실시간 극단 시그널 알림" className={`mb-5 min-w-0 rounded-3xl border p-4 text-sm leading-6 shadow-lg ${className}`}>
      <h2 className="break-words text-lg font-black">{alert.title}</h2>
      <p className="mt-2 break-words">세부: {alert.details}</p>
      <p className="mt-1 break-words">권장 행동: {alert.recommendedAction}</p>
    </section>
  );
}

function BacktestSummary({ summary }: { summary: NonNullable<DashboardPayload['backtestSummary']> }) {
  const totalEvaluated = summary.reports.reduce((total, report) => total + report.evaluatedSignals, 0);
  const totalExcluded = summary.reports.reduce((total, report) => total + report.excludedSignals, 0);
  const btc4h = summary.reports.find((report) => report.asset === 'BTC' && report.interval === '4h');
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-5 text-sm leading-6 text-slate-300">
      <h2 className="font-bold text-slate-100">복합 백테스트 요약</h2>
      <p className="mt-2 text-xs text-slate-400">
        {summary.source} · {new Date(summary.generatedAt).toLocaleDateString('ko-KR', { timeZone: 'UTC' })}
      </p>
      <p className="mt-2 text-xs text-slate-300">
        실제 기간: BTC 4h {btc4h ? `${new Date(btc4h.dataStart).toLocaleDateString('ko-KR', { timeZone: 'UTC' })}–${new Date(btc4h.dataEnd).toLocaleDateString('ko-KR', { timeZone: 'UTC' })}` : '확인 불가'} · 평가 {totalEvaluated}건 · 제외 {totalExcluded}건
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {summary.rows.map((row) => (
          <div key={`${row.asset}-${row.interval}-${row.signalType}`} className="rounded-2xl bg-black/20 p-3">
            <div className="font-bold text-slate-100">
              {row.asset} {row.interval} {row.signalType === 'strong-buy' ? '강력 매수' : '강력 매도'}
            </div>
            <div className="mt-1 text-slate-300">
              신호 {row.signalCount}회 · 적중률 {row.hitRatePercent}% · 평균 종가 수익률 {row.averageCloseReturnPercent}%
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-amber-100">신호 횟수는 ≥80/≤20 구간에 머문 봉 수가 아니라 새 진입(&lt;80→≥80, &gt;20→≤20)만 집계합니다. 알림 발송은 별도로 자산·유형별 6시간 cooldown을 적용합니다. 룩어헤드 방지: 캔들 확정 후 다음 관측 가능 봉의 시가를 진입가로 사용합니다.</p>
    </div>
  );
}

function SignalPill({ tone, children }: { tone: SignalTone; children: React.ReactNode }) {
  const className =
    tone === 'positive'
      ? 'border-emerald-300/40 bg-emerald-300/15 text-emerald-100'
      : tone === 'neutral'
        ? 'border-amber-300/40 bg-amber-300/15 text-amber-100'
        : 'border-rose-300/40 bg-rose-300/15 text-rose-100';

  return <span className={`inline-flex whitespace-nowrap rounded-full border px-3 py-1 text-xs font-black ${className}`}>{children}</span>;
}

function barClass(tone: SignalTone): string {
  const color = tone === 'positive' ? 'bg-emerald-300' : tone === 'neutral' ? 'bg-amber-300' : 'bg-rose-300';
  return `h-2 rounded-full ${color}`;
}

function DashboardSkeleton() {
  return (
    <div role="status" className="grid min-w-0 flex-1 gap-5 lg:grid-cols-[360px_minmax(0,1fr)]" aria-label="대시보드 로딩 중">
      <div className="space-y-3">
        <div className="h-36 animate-pulse rounded-3xl bg-white/10" />
        <div className="h-36 animate-pulse rounded-3xl bg-white/10" />
      </div>
      <div className="h-[34rem] animate-pulse rounded-[2rem] bg-white/10" />
    </div>
  );
}

function notificationPermissionText(permission: NotificationPermission | 'unsupported'): string {
  if (permission === 'granted') return '브라우저 알림 권한이 허용되었습니다.';
  if (permission === 'denied') return '브라우저 알림 권한이 거부되었습니다. 인앱 알림은 계속 표시됩니다.';
  return '이 브라우저는 Notification API를 지원하지 않습니다. 인앱 알림은 계속 표시됩니다.';
}

function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

function readStoredAlertState(): ExtremeSignalAlertState {
  if (typeof window === 'undefined') return {};
  try {
    return parseStoredAlertState(window.localStorage.getItem(ALERT_STATE_STORAGE_KEY));
  } catch {
    return {};
  }
}

function readStoredAlertHistory(): ExtremeSignalAlert[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(ALERT_HISTORY_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredAlert).slice(0, MAX_ALERT_HISTORY);
  } catch {
    return [];
  }
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  try {
    const value = window.localStorage.getItem(key);
    if (value === 'true') return true;
    if (value === 'false') return false;
    return fallback;
  } catch {
    return fallback;
  }
}

function safeLocalStorageSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures so in-app alerts keep working for the current page.
  }
}

function showBrowserNotifications(alerts: ExtremeSignalAlert[]) {
  if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted' || typeof Notification !== 'function') return;
  for (const alert of alerts) {
    try {
      new Notification(alert.title, { body: `${alert.details}\n${alert.recommendedAction}` });
    } catch {
      // Browser notifications are best-effort; in-app alerts and signal refresh must continue.
    }
  }
}

function isStoredAlert(value: unknown): value is ExtremeSignalAlert {
  if (typeof value !== 'object' || value === null) return false;
  const alert = value as Partial<ExtremeSignalAlert>;
  return (
    ASSET_SYMBOLS.includes(alert.assetSymbol as AssetSymbol) &&
    (alert.type === 'strong-buy' || alert.type === 'strong-sell') &&
    typeof alert.score === 'number' &&
    typeof alert.createdAt === 'number' &&
    typeof alert.title === 'string' &&
    typeof alert.details === 'string' &&
    typeof alert.recommendedAction === 'string'
  );
}
