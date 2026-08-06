'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  evaluateExtremeSignalAlerts,
  parseStoredAlertState,
  serializeAlertState,
  type ExtremeSignalAlert,
  type ExtremeSignalAlertState,
} from '@/lib/alerts';
import { formatUsdWithKrw, type AssetSignal, type DashboardPayload, type SignalTone } from '@/lib/signals';

type LoadState = 'loading' | 'refreshing' | 'success' | 'failure';

const REFRESH_INTERVAL_MS = 60_000;
const ALERT_STATE_STORAGE_KEY = 'crypto-signal-dashboard:extreme-alert-state';
const ALERT_HISTORY_STORAGE_KEY = 'crypto-signal-dashboard:extreme-alert-history';
const ALERT_ENABLED_STORAGE_KEY = 'crypto-signal-dashboard:extreme-alert-enabled';
const MAX_ALERT_HISTORY = 10;

export default function Home() {
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<'BTC' | 'ETH'>('BTC');
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [alertsEnabled, setAlertsEnabled] = useState(() => readStoredBoolean(ALERT_ENABLED_STORAGE_KEY, true));
  const [alertState, setAlertState] = useState<ExtremeSignalAlertState>(() => readStoredAlertState());
  const [alertHistory, setAlertHistory] = useState<ExtremeSignalAlert[]>(() => readStoredAlertHistory());
  const [latestAlert, setLatestAlert] = useState<ExtremeSignalAlert | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(() => getNotificationPermission());
  const requestGeneration = useRef(0);
  const alertStateRef = useRef(alertState);
  const alertsEnabledRef = useRef(alertsEnabled);

  useEffect(() => {
    alertStateRef.current = alertState;
    safeLocalStorageSet(ALERT_STATE_STORAGE_KEY, serializeAlertState(alertState));
  }, [alertState]);

  useEffect(() => {
    alertsEnabledRef.current = alertsEnabled;
    safeLocalStorageSet(ALERT_ENABLED_STORAGE_KEY, alertsEnabled ? 'true' : 'false');
  }, [alertsEnabled]);

  useEffect(() => {
    safeLocalStorageSet(ALERT_HISTORY_STORAGE_KEY, JSON.stringify(alertHistory));
  }, [alertHistory]);

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
            <p className="text-sm font-medium uppercase tracking-[0.28em] text-cyan-200/80 sm:tracking-[0.32em]">실시간 시장 시그널</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-5xl">BTC / ETH 시그널 대시보드</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
              점수는 MA20/MA50, RSI(14), MFI(14), Binance 선물 펀딩비·미체결약정, Alternative.me 공포·탐욕 지수를 종합합니다.
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
  selectedSymbol: 'BTC' | 'ETH';
  onSelect: (symbol: 'BTC' | 'ETH') => void;
  stale: boolean;
  usdKrwRate: number | null;
  backtestSummary: DashboardPayload['backtestSummary'] | null;
  alertsEnabled: boolean;
  onToggleAlerts: (enabled: boolean) => void;
  notificationPermission: NotificationPermission | 'unsupported';
  onRequestBrowserNotifications: () => void;
  alertHistory: ExtremeSignalAlert[];
}) {
  return (
    <div className="grid min-w-0 flex-1 gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="min-w-0 space-y-4">
        <div role="tablist" aria-label="자산 선택" className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-1">
          {assets.map((asset) => (
            <button
              key={asset.symbol}
              type="button"
              role="tab"
              aria-selected={asset.symbol === selectedSymbol}
              onClick={() => onSelect(asset.symbol)}
              className="min-w-0 rounded-3xl border border-white/10 bg-white/[0.06] p-4 text-left transition hover:bg-white/[0.10] aria-selected:border-cyan-200/80 aria-selected:bg-cyan-200/15"
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
            지표 결측은 0점이나 만점으로 숨기지 않고 사용 가능한 가중치만 100점으로 정규화합니다. ETH는 기본 점수 95%와 ETH/BTC 상대강도 5%를 혼합합니다.
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
            {stale ? <p className="mt-2 text-sm font-semibold text-amber-200">오래된 데이터: 새로고침 실패 후 캐시된 스냅샷을 표시합니다.</p> : null}
          </div>
          <ScoreGauge assetName={selectedAsset.name} score={selectedAsset.overallScore} tone={selectedAsset.signal.tone} label={selectedAsset.signal.label} />
        </div>

        <div className="mt-7 grid min-w-0 gap-4 sm:grid-cols-2">
          {selectedAsset.indicators.map((indicator) => (
            <article key={indicator.id} className="min-w-0 rounded-3xl border border-white/10 bg-slate-950/35 p-5">
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
            </article>
          ))}
        </div>
      </section>
    </div>
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
          <p className="mt-1 text-slate-300">80점 이상 재진입과 20점 이하 재진입을 BTC/ETH별로 감시합니다.</p>
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
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-5 text-sm leading-6 text-slate-300">
      <h2 className="font-bold text-slate-100">복합 백테스트 요약</h2>
      <p className="mt-2 text-xs text-slate-400">
        {summary.source} · {new Date(summary.generatedAt).toLocaleDateString('ko-KR', { timeZone: 'UTC' })}
      </p>
      <div className="mt-4 space-y-3">
        {summary.rows.slice(0, 4).map((row) => (
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
      <p className="mt-3 text-xs text-amber-100">룩어헤드 방지: 캔들 확정 후 다음 관측 가능 봉의 시가를 진입가로 사용합니다.</p>
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
  return parseStoredAlertState(window.localStorage.getItem(ALERT_STATE_STORAGE_KEY));
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
  const value = window.localStorage.getItem(key);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
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
    new Notification(alert.title, { body: `${alert.details}\n${alert.recommendedAction}` });
  }
}

function isStoredAlert(value: unknown): value is ExtremeSignalAlert {
  if (typeof value !== 'object' || value === null) return false;
  const alert = value as Partial<ExtremeSignalAlert>;
  return (
    (alert.assetSymbol === 'BTC' || alert.assetSymbol === 'ETH') &&
    (alert.type === 'strong-buy' || alert.type === 'strong-sell') &&
    typeof alert.score === 'number' &&
    typeof alert.createdAt === 'number' &&
    typeof alert.title === 'string' &&
    typeof alert.details === 'string' &&
    typeof alert.recommendedAction === 'string'
  );
}
