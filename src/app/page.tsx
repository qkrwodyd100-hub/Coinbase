'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatUsd, type AssetSignal, type DashboardPayload, type SignalTone } from '@/lib/signals';

type LoadState = 'loading' | 'refreshing' | 'success' | 'failure';

const REFRESH_INTERVAL_MS = 60_000;

export default function Home() {
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<'BTC' | 'ETH'>('BTC');
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);

  const refreshSignals = useCallback(async () => {
    setLoadState((current) => (current === 'loading' ? 'loading' : 'refreshing'));
    setError(null);

    try {
      const response = await fetch('/api/signals', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Could not refresh market data.');
      }
      const nextPayload = (await response.json()) as DashboardPayload;
      setPayload(nextPayload);
      setLoadState('success');
      setSelectedSymbol((current) => (nextPayload.assets.some((asset) => asset.symbol === current) ? current : (nextPayload.assets[0]?.symbol ?? 'BTC')));
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Could not refresh crypto signals.');
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
    <main className="min-h-screen overflow-hidden bg-[#080b14] text-slate-50">
      <div className="absolute inset-0 -z-0 bg-[radial-gradient(circle_at_top_left,rgba(47,118,255,0.30),transparent_35%),radial-gradient(circle_at_80%_10%,rgba(20,184,166,0.18),transparent_28%),linear-gradient(135deg,#080b14,#101827_48%,#050608)]" />
      <section className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-6 flex flex-col gap-4 rounded-[2rem] border border-white/10 bg-white/[0.06] p-5 shadow-2xl shadow-black/30 backdrop-blur md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.32em] text-cyan-200/80">Live market signals</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-5xl">BTC / ETH Signal Dashboard</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
              Scores combine RSI(14), Alternative.me Fear & Greed, MA20/MA50 trend alignment, and Binance futures funding.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-300">
              <span className="block text-xs uppercase tracking-[0.22em] text-slate-500">Last update</span>
              <time>{payload ? new Date(payload.asOf).toLocaleTimeString('en-US', { hour12: false, timeZone: 'UTC' }) : 'Waiting...'}</time>
            </div>
            <button
              type="button"
              onClick={() => void refreshSignals()}
              disabled={isBusy}
              aria-label={isBusy ? 'Refreshing signals' : 'Refresh signals'}
              className="rounded-2xl bg-cyan-300 px-5 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-cyan-950/30 transition hover:-translate-y-0.5 hover:bg-cyan-200 disabled:translate-y-0 disabled:cursor-wait disabled:bg-slate-500"
            >
              {isBusy ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </header>

        {error ? (
          <div role="alert" className="mb-5 rounded-2xl border border-rose-400/40 bg-rose-500/10 p-4 text-sm text-rose-100">
            <strong>Could not refresh signals.</strong> {hasStaleData ? 'Showing the last successful snapshot.' : 'Try again in a moment.'}
          </div>
        ) : null}

        {!selectedAsset && loadState === 'loading' ? <DashboardSkeleton /> : null}
        {selectedAsset ? (
          <DashboardContent
            assets={payload?.assets ?? []}
            selectedAsset={selectedAsset}
            selectedSymbol={selectedSymbol}
            onSelect={setSelectedSymbol}
            stale={hasStaleData || selectedAsset.stale}
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
}: {
  assets: AssetSignal[];
  selectedAsset: AssetSignal;
  selectedSymbol: 'BTC' | 'ETH';
  onSelect: (symbol: 'BTC' | 'ETH') => void;
  stale: boolean;
}) {
  return (
    <div className="grid flex-1 gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="space-y-4">
        <div role="tablist" aria-label="Assets" className="grid grid-cols-2 gap-3 lg:grid-cols-1">
          {assets.map((asset) => (
            <button
              key={asset.symbol}
              type="button"
              role="tab"
              aria-selected={asset.symbol === selectedSymbol}
              onClick={() => onSelect(asset.symbol)}
              className="rounded-3xl border border-white/10 bg-white/[0.06] p-4 text-left transition hover:bg-white/[0.10] aria-selected:border-cyan-200/80 aria-selected:bg-cyan-200/15"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="text-xl font-black">{asset.symbol}</span>
                  <span className="ml-2 text-sm text-slate-400">{asset.name}</span>
                </div>
                <SignalPill tone={asset.signal.tone}>{asset.signal.label}</SignalPill>
              </div>
              <div className="mt-4 text-2xl font-black">{formatUsd(asset.price)}</div>
              <div className="mt-2 h-2 rounded-full bg-white/10">
                <div className={barClass(asset.signal.tone)} style={{ width: `${asset.overallScore}%` }} />
              </div>
            </button>
          ))}
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-5 text-sm leading-6 text-slate-300">
          <h2 className="font-bold text-slate-100">Scoring note</h2>
          <p className="mt-2">
            Mixed moving-average cases use 10 points when price is at/above either MA, otherwise 5 points unless the fully bearish case scores 0.
          </p>
        </div>
      </aside>

      <section className="rounded-[2rem] border border-white/10 bg-white/[0.07] p-5 shadow-2xl shadow-black/30 backdrop-blur sm:p-7">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.28em] text-slate-400">{selectedAsset.symbol}</p>
            <h2 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">{selectedAsset.name} Signal</h2>
            {stale ? <p className="mt-2 text-sm font-semibold text-amber-200">Stale data: showing cached snapshot after refresh failure.</p> : null}
          </div>
          <ScoreGauge score={selectedAsset.overallScore} tone={selectedAsset.signal.tone} label={selectedAsset.signal.label} />
        </div>

        <div className="mt-7 grid gap-4 sm:grid-cols-2">
          {selectedAsset.indicators.map((indicator) => (
            <article key={indicator.id} className="rounded-3xl border border-white/10 bg-slate-950/35 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-bold text-slate-100">{indicator.title}</h3>
                  <p className="mt-1 text-2xl font-black">{indicator.value}</p>
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

function ScoreGauge({ score, tone, label }: { score: number; tone: SignalTone; label: string }) {
  const strokeClass = tone === 'positive' ? 'stroke-emerald-300' : tone === 'neutral' ? 'stroke-amber-300' : 'stroke-rose-300';
  const dash = `${score}, 100`;

  return (
    <div className="flex items-center gap-4 rounded-3xl border border-white/10 bg-black/20 p-4">
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
        <div className="text-sm text-slate-400">of 100</div>
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

  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black ${className}`}>{children}</span>;
}

function barClass(tone: SignalTone): string {
  const color = tone === 'positive' ? 'bg-emerald-300' : tone === 'neutral' ? 'bg-amber-300' : 'bg-rose-300';
  return `h-2 rounded-full ${color}`;
}

function DashboardSkeleton() {
  return (
    <div className="grid flex-1 gap-5 lg:grid-cols-[360px_minmax(0,1fr)]" aria-label="Loading dashboard">
      <div className="space-y-3">
        <div className="h-36 animate-pulse rounded-3xl bg-white/10" />
        <div className="h-36 animate-pulse rounded-3xl bg-white/10" />
      </div>
      <div className="h-[34rem] animate-pulse rounded-[2rem] bg-white/10" />
    </div>
  );
}
