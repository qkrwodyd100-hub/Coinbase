'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatUsdWithKrw, type AssetSignal, type DashboardPayload, type SignalTone } from '@/lib/signals';

type LoadState = 'loading' | 'refreshing' | 'success' | 'failure';

const REFRESH_INTERVAL_MS = 60_000;

export default function Home() {
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<'BTC' | 'ETH'>('BTC');
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const requestGeneration = useRef(0);

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
      setPayload(nextPayload);
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
              점수는 RSI(14), Alternative.me 공포·탐욕 지수, MA20/MA50 추세 정렬, Kraken 선물 펀딩을 종합합니다.
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

        {!selectedAsset && loadState === 'loading' ? <DashboardSkeleton /> : null}
        {selectedAsset ? (
          <DashboardContent
            assets={payload?.assets ?? []}
            selectedAsset={selectedAsset}
            selectedSymbol={selectedSymbol}
            onSelect={setSelectedSymbol}
            stale={hasStaleData || selectedAsset.stale}
            usdKrwRate={payload?.usdKrwRate ?? null}
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
}: {
  assets: AssetSignal[];
  selectedAsset: AssetSignal;
  selectedSymbol: 'BTC' | 'ETH';
  onSelect: (symbol: 'BTC' | 'ETH') => void;
  stale: boolean;
  usdKrwRate: number | null;
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
            이동평균이 엇갈린 경우 가격이 MA20 또는 MA50 이상이면 10점, 두 이동평균 아래지만 완전한 약세 배열이 아니면 5점, 완전한 약세 배열이면 0점을 부여합니다.
          </p>
        </div>
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
                  <p className="mt-1 break-words text-xl font-black leading-tight sm:text-2xl">{indicator.value}</p>
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
